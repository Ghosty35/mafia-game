-- 112_armory_power_limitless.sql
-- =====================================================================
-- Remove the 10,000 total-power ownership cap from buy_power(). Per the
-- game design, players should be able to buy as much personal power as
-- they can afford — more power is strictly better, there is no ceiling.
-- The server-side price table (from 109) stays intact; only the cap
-- check is removed. The client 'cost' argument remains ignored.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.buy_power(power_amount int, cost bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  real_cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Canonical armory packs (source of truth: app/armory/page.tsx).
  -- The client-supplied `cost` is intentionally ignored.
  real_cost := CASE power_amount
                 WHEN 50   THEN 1200
                 WHEN 150  THEN 3500
                 WHEN 400  THEN 8500
                 WHEN 1000 THEN 18000
                 ELSE NULL
               END;
  IF real_cost IS NULL THEN RAISE EXCEPTION 'INVALID_ITEM'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.cash < real_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  -- No power cap: a player may buy unlimited personal power.

  UPDATE public.players
  SET cash = cash - real_cost,
      power = power + power_amount
  WHERE id = p.id;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'charged', real_cost,
    'power', p.power,
    'player', to_jsonb(p)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.buy_power(int, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_power(int, bigint) TO authenticated;

COMMENT ON FUNCTION public.buy_power(int, bigint) IS
  'Buy armory power packs. Server-side price table (client cost ignored). Unlimited total power.';
