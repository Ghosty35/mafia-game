-- 109_buy_power_pricetable_and_cap.sql
-- =====================================================================
-- SECURITY REGRESSION FIX.
-- ---------------------------------------------------------------------
-- Migration 044 hardened buy_power() with a SERVER-SIDE price table so a
-- client could not pass cost:0 and get free power. Migration 090 later
-- re-added the 10000 ownership cap but REVERTED to trusting the client
-- 'cost' argument again (charged `cost`, checked `p.cash < cost`). Because
-- 090 runs after 044, the exploitable version is what is live: a player
-- can call buy_power(power_amount => 1000, cost => 0) for free power.
--
-- This migration restores the server-side price table AND keeps the
-- ownership cap. The client 'cost' argument is now ignored entirely.
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
  MAX_POWER constant int := 10000;
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

  -- Ownership cap: reject if this purchase would exceed MAX_POWER.
  IF COALESCE(p.power, 0) + power_amount > MAX_POWER THEN
    RAISE EXCEPTION 'POWER_CAP_REACHED';
  END IF;

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
  'Buy armory power packs. Server-side price table (client cost ignored). Capped at 10000 total power.';

-- =====================================================================
-- Drop the legacy exploitable overload of buy_family_buff_diamonds.
-- ---------------------------------------------------------------------
-- Migration 035 created buy_family_buff_diamonds(cost_diamonds bigint,
-- power_gain int) where the caller supplied power_gain (only loosely
-- bounded). Migrations 086/101 replaced it with a
-- (cost_diamonds bigint, p_is_bundle boolean) version that derives power
-- server-side — but because the signatures differ, Postgres keeps BOTH
-- functions, and PostgREST will happily route a call to the old, weaker
-- one if the client sends {cost_diamonds, power_gain}. Drop it.
-- =====================================================================
DROP FUNCTION IF EXISTS public.buy_family_buff_diamonds(bigint, int);

-- Same class of bug: migration 041 created buy_family_buff_cash(cost_cash
-- bigint, power_gain integer) with caller-supplied power_gain, superseded
-- by 086/101's (cost_cash bigint) derived-power version. The old overload
-- lingers as a separate signature — drop it.
DROP FUNCTION IF EXISTS public.buy_family_buff_cash(bigint, integer);

