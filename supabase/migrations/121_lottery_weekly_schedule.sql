-- 121_lottery_weekly_schedule.sql
-- Weekly lottery draw every Wednesday at 8pm (Europe/Amsterdam).
-- Admin can trigger early draw or reset schedule.

-- ============================================================
-- 1) Add next_draw to casino_pools
-- ============================================================
ALTER TABLE public.casino_pools
  ADD COLUMN IF NOT EXISTS next_draw timestamptz;

UPDATE public.casino_pools
SET next_draw = (now() + interval '7 days')::timestamptz
WHERE id = 1 AND next_draw IS NULL;

-- ============================================================
-- 2) Helper: calculate next Wednesday 20:00 Europe/Amsterdam
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_lottery_draw()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Amsterdam' + interval '7 days') AT TIME ZONE 'Europe/Amsterdam'
          + interval '20 hour')::timestamptz;
$$;

-- ============================================================
-- 3) Admin: set lottery schedule
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_lottery_schedule(next_draw timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.casino_pools
  SET next_draw = admin_set_lottery_schedule.next_draw
  WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'next_draw', next_draw);
END;
$$;

-- ============================================================
-- 4) Admin: draw lottery (checks schedule)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_draw_lottery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pool bigint;
  v_winner uuid;
  v_prize bigint;
  v_uname text;
  v_next_draw timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT lottery, next_draw INTO v_pool, v_next_draw
  FROM public.casino_pools WHERE id = 1 FOR UPDATE;

  v_pool := COALESCE(v_pool, 0);
  IF v_pool <= 0 THEN RAISE EXCEPTION 'LOTTERY_EMPTY'; END IF;

  IF v_next_draw IS NOT NULL AND now() < v_next_draw THEN
    RAISE EXCEPTION 'LOTTERY_NOT_DUE: next draw at %', v_next_draw;
  END IF;

  SELECT id, username INTO v_winner, v_uname
  FROM public.players
  WHERE last_active > now() - interval '30 days'
  ORDER BY random()
  LIMIT 1;

  IF v_winner IS NULL THEN RAISE EXCEPTION 'NO_ELIGIBLE_PLAYERS'; END IF;

  v_prize := floor(v_pool * 0.08);
  IF v_prize < 1000 THEN v_prize := LEAST(v_pool, 1000); END IF;

  UPDATE public.players SET cash = cash + v_prize WHERE id = v_winner;
  UPDATE public.casino_pools
  SET lottery = GREATEST(0, lottery - v_prize),
      next_draw = public.next_lottery_draw(),
      updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'winner', v_uname, 'prize', v_prize, 'pool_left', GREATEST(0, v_pool - v_prize), 'next_draw', public.next_lottery_draw());
END;
$$;

-- ============================================================
-- 5) Grants
-- ============================================================
REVOKE ALL ON FUNCTION public.next_lottery_draw() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.next_lottery_draw() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_lottery_schedule(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_lottery_schedule(timestamptz) TO authenticated;
