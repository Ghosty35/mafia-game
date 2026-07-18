-- 106_lottery_admin_control.sql
-- =====================================================================
-- Admin banking control for the Lottery, mirroring the Gov Tax Bank
-- pattern from 103. The lottery pool lives in casino_pools.lottery;
-- the Admin can now read it, deposit into it, withdraw from it, and
-- trigger a manual draw (payout to a random eligible player).
-- =====================================================================

-- Read the lottery pool (admin only).
CREATE OR REPLACE FUNCTION public.admin_get_lottery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pool bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT lottery INTO v_pool FROM public.casino_pools WHERE id = 1;
  RETURN jsonb_build_object('pool', COALESCE(v_pool, 0));
END;
$$;

-- Admin deposits funds into the lottery pool (e.g. seed a jackpot).
CREATE OR REPLACE FUNCTION public.admin_deposit_lottery(p_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pool bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  INSERT INTO public.casino_pools (id, lottery, updated_at) VALUES (1, 0, now())
    ON CONFLICT (id) DO NOTHING;

  UPDATE public.casino_pools SET lottery = lottery + p_amount, updated_at = now() WHERE id = 1
    RETURNING lottery INTO v_pool;

  RETURN jsonb_build_object('success', true, 'deposited', p_amount, 'pool', v_pool);
END;
$$;

-- Admin withdraws funds from the lottery pool into their own cash.
CREATE OR REPLACE FUNCTION public.admin_withdraw_lottery(p_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pool bigint;
  v_admin public.players;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT lottery INTO v_pool FROM public.casino_pools WHERE id = 1 FOR UPDATE;
  IF COALESCE(v_pool, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_LOTTERY'; END IF;

  UPDATE public.casino_pools SET lottery = lottery - p_amount, updated_at = now() WHERE id = 1;

  SELECT * INTO v_admin FROM public.players WHERE id = auth.uid() FOR UPDATE;
  UPDATE public.players SET cash = cash + p_amount WHERE id = v_admin.id;

  RETURN jsonb_build_object('success', true, 'withdrawn', p_amount, 'pool', v_pool - p_amount, 'new_cash', v_admin.cash + p_amount);
END;
$$;

-- Admin triggers a manual lottery draw: pays 8% of the current pool to a
-- single random eligible player (has entered at least once / has cash),
-- then resets the pool to 0. Keeps the economy moving between schedules.
CREATE OR REPLACE FUNCTION public.admin_draw_lottery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pool bigint;
  v_winner uuid;
  v_prize bigint;
  v_uname text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT lottery INTO v_pool FROM public.casino_pools WHERE id = 1 FOR UPDATE;
  v_pool := COALESCE(v_pool, 0);
  IF v_pool <= 0 THEN RAISE EXCEPTION 'LOTTERY_EMPTY'; END IF;

  -- Pick a random active player as the winner.
  SELECT id, username INTO v_winner, v_uname
  FROM public.players
  WHERE last_active > now() - interval '30 days'
  ORDER BY random()
  LIMIT 1;

  IF v_winner IS NULL THEN RAISE EXCEPTION 'NO_ELIGIBLE_PLAYERS'; END IF;

  v_prize := floor(v_pool * 0.08);
  IF v_prize < 1000 THEN v_prize := LEAST(v_pool, 1000); END IF;

  UPDATE public.players SET cash = cash + v_prize WHERE id = v_winner;
  UPDATE public.casino_pools SET lottery = GREATEST(0, lottery - v_prize), updated_at = now() WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'winner', v_uname, 'prize', v_prize, 'pool_left', GREATEST(0, v_pool - v_prize));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lottery()           FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_deposit_lottery(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_withdraw_lottery(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_draw_lottery()          FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lottery()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deposit_lottery(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_lottery(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_draw_lottery()          TO authenticated;
