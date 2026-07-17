-- ============================================================
-- 086: Make family-buff power_gain server-derived (exploit fix)
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- (or `supabase db remote commit`)
--
-- Bug (security): buy_family_buff_cash / buy_family_buff_diamonds
-- accepted a caller-supplied `power_gain` and only bound-checked it
-- (power_gain <= cost/4000 or <= diamonds*6). A malicious client could
-- pass the MAXIMUM allowed power_gain for a given cost and receive
-- ~2x the intended family power for the same price.
--
-- Fix: power_gain is now DERIVED server-side from the amount spent and
-- the trusted parameters no longer include power_gain at all. The
-- conversion rates below are the single source of truth for balance.
--   cash:          power = greatest(5, floor(cost_cash / 8000))
--   diamonds:      power = floor(cost_diamonds * 1.8)
--   diamonds bundle: power = floor(cost_diamonds * 4.0)   (donator-only)
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_family_buff_cash(cost_cash bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_cash <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- Derive power server-side; client can no longer influence it.
  power_gain := GREATEST(5, FLOOR(cost_cash / 8000));

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost_cash THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET cash = cash - cost_cash WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_family_buff_diamonds(cost_diamonds bigint, p_is_bundle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
  rate numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_diamonds <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- Single purchase is better value than cash; bundle is the best value.
  -- Both rates are server-defined and the client cannot override them.
  rate := CASE WHEN p_is_bundle THEN 4.0 ELSE 1.8 END;
  power_gain := FLOOR(cost_diamonds * rate);

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(p.diamonds, 0) < cost_diamonds THEN RAISE EXCEPTION 'NOT_ENOUGH_DIAMONDS'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET diamonds = diamonds - cost_diamonds WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;
