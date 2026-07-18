-- 115_druglab_system.sql
-- Drug Lab: standalone production facility per city.
-- Players buy a lab, choose a drug type (Coke, Meth, Pills),
-- and collect produced drugs into drug_storage. No cron needed:
-- pending production is computed lazily at collect time, capped at 24h.
-- Max 1 lab per player. Upgrades cost cash, boost production rate.

CREATE TABLE IF NOT EXISTS public.player_druglabs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  city           text NOT NULL,
  drug_type      text NOT NULL CHECK (drug_type IN ('Coke','Meth','Pills')),
  level          int NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  last_collected timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_druglabs_player_idx ON public.player_druglabs(player_id);
ALTER TABLE public.player_druglabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_druglabs_select_own ON public.player_druglabs;
CREATE POLICY player_druglabs_select_own ON public.player_druglabs
  FOR SELECT USING (player_id = auth.uid());
DROP POLICY IF EXISTS player_druglabs_modify_own ON public.player_druglabs;
CREATE POLICY player_druglabs_modify_own ON public.player_druglabs
  FOR ALL USING (player_id = auth.uid()) WITH CHECK (player_id = auth.uid());

CREATE OR REPLACE FUNCTION public._druglab_rates()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'buy_cost',     200000,
    'buy_tax_rate', 0.02,
    'upgrade_base', 150000,
    'max_level',    10,
    'cap_hours',    24,
    'coke_rate',    2,
    'meth_rate',    3,
    'pills_rate',   4
  );
$$;

CREATE OR REPLACE FUNCTION public._druglab_pending(p_drug_type text, p_level int, p_last timestamptz)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  r jsonb := public._druglab_rates();
  rate int;
  cap_hours int := (r->>'cap_hours')::int;
  hrs numeric;
BEGIN
  rate := CASE p_drug_type
            WHEN 'Coke'  THEN (r->>'coke_rate')::int
            WHEN 'Meth'  THEN (r->>'meth_rate')::int
            WHEN 'Pills' THEN (r->>'pills_rate')::int
            ELSE 0
          END;
  hrs := LEAST(cap_hours, EXTRACT(EPOCH FROM (now() - p_last)) / 3600.0);
  RETURN floor(rate * p_level * hrs);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_druglab(p_city text, p_drug_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  r jsonb := public._druglab_rates();
  cost bigint := (r->>'buy_cost')::bigint;
  tax bigint;
  lid uuid;
  owned int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT COUNT(*) INTO owned FROM public.player_druglabs WHERE player_id = p.id;
  IF owned >= 1 THEN RAISE EXCEPTION 'LAB_LIMIT'; END IF;

  tax := floor(cost * (r->>'buy_tax_rate')::numeric)::bigint;

  INSERT INTO public.player_druglabs (player_id, city, drug_type)
  VALUES (p.id, p_city, p_drug_type) RETURNING id INTO lid;

  UPDATE public.players
  SET cash = cash - cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'lab_id', lid, 'city', p_city, 'drug_type', p_drug_type, 'cost', cost, 'tax', tax);
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_druglab(p_lab_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  lab public.player_druglabs;
  pending bigint;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
  IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;

  pending := public._druglab_pending(lab.drug_type, lab.level, lab.last_collected);
  IF pending <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_COLLECT'; END IF;

  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[lab.drug_type],
                            to_jsonb(COALESCE((p.drug_storage->>lab.drug_type)::int, 0) + pending));

  UPDATE public.players SET drug_storage = new_storage WHERE id = p.id;
  UPDATE public.player_druglabs SET last_collected = now() WHERE id = lab.id;

  RETURN jsonb_build_object('success', true, 'lab_id', lab.id, 'drug_type', lab.drug_type,
                            'collected', pending, 'new_total', (new_storage->>lab.drug_type)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.upgrade_druglab(p_lab_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  lab public.player_druglabs;
  r jsonb := public._druglab_rates();
  max_level int := (r->>'max_level')::int;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
  IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;
  IF lab.level >= max_level THEN RAISE EXCEPTION 'LAB_MAX_LEVEL'; END IF;

  cost := ((r->>'upgrade_base')::bigint) * lab.level;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_druglabs SET level = level + 1 WHERE id = lab.id;

  RETURN jsonb_build_object('success', true, 'lab_id', lab.id, 'new_level', lab.level + 1, 'cost', cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_druglabs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  labs jsonb;
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', dl.id, 'city', dl.city, 'drug_type', dl.drug_type, 'level', dl.level,
      'pending', public._druglab_pending(dl.drug_type, dl.level, dl.last_collected),
      'rate', CASE dl.drug_type
                WHEN 'Coke'  THEN (public._druglab_rates()->>'coke_rate')::int
                WHEN 'Meth'  THEN (public._druglab_rates()->>'meth_rate')::int
                WHEN 'Pills' THEN (public._druglab_rates()->>'pills_rate')::int
                ELSE 0
              END * dl.level,
      'last_collected', dl.last_collected, 'created_at', dl.created_at
    ) ORDER BY dl.created_at
  ), '[]'::jsonb) INTO labs
  FROM public.player_druglabs dl WHERE dl.player_id = auth.uid();

  RETURN jsonb_build_object('labs', labs, 'count', COALESCE(jsonb_array_length(labs), 0), 'limit', 1);
END;
$$;

-- ---------- grants ----------
REVOKE ALL ON FUNCTION public._druglab_rates() FROM public, anon;
GRANT EXECUTE ON FUNCTION public._druglab_rates() TO authenticated;
REVOKE ALL ON FUNCTION public._druglab_pending(text, int, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._druglab_pending(text, int, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.buy_druglab(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_druglab(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.collect_druglab(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.collect_druglab(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.upgrade_druglab(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_druglab(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_druglabs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_druglabs() TO authenticated;
