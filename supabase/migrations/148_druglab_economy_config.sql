-- 148_druglab_economy_config.sql
-- Move all drug-lab hardcoded economy values into game_config so admins
-- can tune them live. Server RPCs read from _cfg(); client reads from
-- get_economy_config().

BEGIN;

-- Seed new keys at their CURRENT values so behavior is unchanged.
INSERT INTO public.game_config (key, num, label) VALUES
  ('druglab_buy_cost',     200000, 'Cost to buy a drug lab'),
  ('druglab_buy_tax_rate', 0.02,   'Buy tax rate for drug labs'),
  ('druglab_upgrade_base', 150000, 'Base cost per lab level upgrade'),
  ('druglab_max_level',    10,     'Max drug lab level'),
  ('druglab_cap_hours',    24,     'Production cap hours'),
  ('druglab_coke_rate',    2,      'Coke production rate per hour per level'),
  ('druglab_meth_rate',    3,      'Meth production rate per hour per level'),
  ('druglab_pills_rate',   4,      'Pills production rate per hour per level'),
  ('druglab_guard_1',      50000,  'Guard cost tier 1'),
  ('druglab_guard_2',      100000, 'Guard cost tier 2'),
  ('druglab_guard_3',      200000, 'Guard cost tier 3'),
  ('druglab_guard_4',      350000, 'Guard cost tier 4'),
  ('druglab_guard_5',      500000, 'Guard cost tier 5'),
  ('druglab_bribe_base',   20000,  'Bribe base cost'),
  ('druglab_bribe_rate',   50,     'Bribe cost per pending kg'),
  ('druglab_bribe_max',    150000, 'Bribe max cost')
ON CONFLICT (key) DO NOTHING;

-- Rewrite _druglab_rates() to read from config instead of hardcoded literals.
CREATE OR REPLACE FUNCTION public._druglab_rates()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'buy_cost',     public._cfg('druglab_buy_cost', 200000)::bigint,
    'buy_tax_rate', public._cfg('druglab_buy_tax_rate', 0.02)::numeric,
    'upgrade_base', public._cfg('druglab_upgrade_base', 150000)::bigint,
    'max_level',    public._cfg('druglab_max_level', 10)::int,
    'cap_hours',    public._cfg('druglab_cap_hours', 24)::int,
    'coke_rate',    public._cfg('druglab_coke_rate', 2)::int,
    'meth_rate',    public._cfg('druglab_meth_rate', 3)::int,
    'pills_rate',   public._cfg('druglab_pills_rate', 4)::int
  );
$$;

-- Rewrite hire_lab_guards to use config for guard costs.
CREATE OR REPLACE FUNCTION public.hire_lab_guards(p_lab_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p    public.players;
  lab  public.player_druglabs;
  cost bigint;
  tier int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
  IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;
  IF lab.guards >= 5 THEN RAISE EXCEPTION 'GUARDS_MAX'; END IF;

  tier := lab.guards + 1;
  cost := CASE tier
    WHEN 1 THEN public._cfg('druglab_guard_1', 50000)::bigint
    WHEN 2 THEN public._cfg('druglab_guard_2', 100000)::bigint
    WHEN 3 THEN public._cfg('druglab_guard_3', 200000)::bigint
    WHEN 4 THEN public._cfg('druglab_guard_4', 350000)::bigint
    WHEN 5 THEN public._cfg('druglab_guard_5', 500000)::bigint
  END;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_druglabs SET guards = guards + 1 WHERE id = lab.id;

  RETURN jsonb_build_object('success', true, 'guards', lab.guards + 1, 'cost', cost);
END;
$$;

REVOKE ALL ON FUNCTION public.hire_lab_guards(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hire_lab_guards(uuid) TO authenticated;

-- Rewrite collect_druglab bribe formula to use config.
CREATE OR REPLACE FUNCTION public.collect_druglab(p_lab_id uuid, p_bribe boolean default false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  lab public.player_druglabs;
  pending bigint;
  new_storage jsonb;
  new_total int;
  cap int := 500000;
  v_pct int;
  v_fee bigint;
  v_heat int := public._cfg('druglab_raid_heat', 20)::int;
  v_cd int := public._cfg('druglab_raid_cooldown_min', 60)::int;
  v_raided boolean := false;
  v_bribed boolean := false;
  v_ok boolean;
  v_bribe_base bigint := public._cfg('druglab_bribe_base', 20000)::bigint;
  v_bribe_rate bigint := public._cfg('druglab_bribe_rate', 50)::bigint;
  v_bribe_max bigint := public._cfg('druglab_bribe_max', 150000)::bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
  IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;
  IF lab.raided_until IS NOT NULL AND lab.raided_until > now() THEN RAISE EXCEPTION 'LAB_RAIDED'; END IF;

  pending := public._druglab_pending(lab.drug_type, lab.level, lab.last_collected);
  IF pending <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_COLLECT'; END IF;

  new_total := COALESCE((p.drug_storage->>lab.drug_type)::int, 0) + pending;
  IF new_total > cap THEN RAISE EXCEPTION 'LAB_CAP_REACHED'; END IF;

  v_pct := public._druglab_raid_pct(pending, lab.guards);

  -- Optional bribe: pay up front, can still fail.
  IF p_bribe THEN
    v_fee := least(v_bribe_max, v_bribe_base + (pending * v_bribe_rate));
    IF p.cash < v_fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH_BRIBE'; END IF;
    UPDATE public.players SET cash = cash - v_fee WHERE id = p.id;
    v_bribed := true;
    v_ok := random() < (public._cfg('druglab_bribe_success', 60) / 100.0);
    IF NOT v_ok THEN v_raided := true; END IF;
  ELSE
    v_raided := random() < (v_pct / 100.0);
  END IF;

  IF v_raided THEN
    UPDATE public.players
      SET heat = least(100, coalesce(heat, 0) + v_heat), heat_updated_at = now()
      WHERE id = p.id;
    UPDATE public.player_druglabs
      SET last_collected = now(), raided_until = now() + make_interval(mins => v_cd)
      WHERE id = lab.id;
    PERFORM public.log_event('bust', 'had a ' || lab.drug_type || ' lab raided in ' || lab.city || '!');
    RETURN jsonb_build_object('success', true, 'raided', true, 'bribed', v_bribed,
      'bribe_fee', COALESCE(v_fee, 0), 'seized', pending, 'drug_type', lab.drug_type,
      'raid_pct', v_pct, 'offline_min', v_cd);
  END IF;

  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[lab.drug_type], to_jsonb(new_total));
  UPDATE public.players SET drug_storage = new_storage WHERE id = p.id;
  UPDATE public.player_druglabs SET last_collected = now() WHERE id = lab.id;

  RETURN jsonb_build_object('success', true, 'raided', false, 'bribed', v_bribed,
    'bribe_fee', COALESCE(v_fee, 0), 'lab_id', lab.id, 'drug_type', lab.drug_type,
    'collected', pending, 'new_total', new_total, 'raid_pct', v_pct);
END;
$$;

REVOKE ALL ON FUNCTION public.collect_druglab(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.collect_druglab(uuid, boolean) TO authenticated;

COMMIT;
