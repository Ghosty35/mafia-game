-- ============================================================
-- 041: Fix the shop's "pay with cash" VIP family buff path
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
--
-- Bug: app/shop/page.tsx's cash-payment path for Family VIP buffs
-- called buy_family_power(), which spends the FAMILY BANK, not the
-- player's personal cash. The player's own cash was never checked
-- or deducted, so clicking "pay with cash" failed with
-- INVALID_SPEND_AMOUNT whenever the family bank (not the player)
-- was short on funds -- regardless of how much cash the player
-- personally had.
--
-- Fix: dedicated cash-funded twin of buy_family_buff_diamonds() --
-- deducts the player's own cash, grants family power atomically.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_family_buff_cash(cost_cash bigint, power_gain integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_cash <= 0 OR power_gain <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF power_gain > cost_cash / 4000 THEN RAISE EXCEPTION 'POWER_GAIN_TOO_HIGH'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost_cash THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET cash = cash - cost_cash WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;
