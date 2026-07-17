-- ============================================================
-- 090: buy_power ownership cap + client-side limit helpers
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- (or `supabase db remote commit`)
--
-- buy_power() had NO cap on total power a player can own. A player
-- could click the armory pack repeatedly and accumulate unbounded
-- power, which trivializes family wars and heist balance.
--
-- Fix: add a MAX_POWER ownership cap (10000). Once reached, further
-- buys are rejected with POWER_CAP_REACHED. The server remains the
-- source of truth; the client only reflects the cap.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_power(power_amount int, cost bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  MAX_POWER constant int := 10000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  -- Reject if this purchase would exceed the ownership cap.
  IF COALESCE(p.power, 0) + power_amount > MAX_POWER THEN
    RAISE EXCEPTION 'POWER_CAP_REACHED';
  END IF;

  p.cash := p.cash - cost;
  p.power := p.power + power_amount;

  UPDATE public.players SET cash = p.cash, power = p.power WHERE id = p.id;
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

COMMENT ON FUNCTION public.buy_power(int, bigint) IS 'Buy power packs from the armory. Capped at 10000 total power per player.';
