-- 117_remove_weed_from_druglab.sql
-- Remove Weed from drug lab system per project constraint:
-- No weed lab feature — not to be implemented.

ALTER TABLE public.player_druglabs DROP CONSTRAINT IF EXISTS player_druglabs_drug_type_check;
ALTER TABLE public.player_druglabs ADD CONSTRAINT player_druglabs_drug_type_check CHECK (drug_type IN ('Coke','Meth','Pills'));

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
