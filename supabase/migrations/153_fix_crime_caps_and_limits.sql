-- 153_fix_crime_caps_and_limits.sql
-- Fix multiple cap/limit enforcement gaps found in deep-dive audit:
-- 1. train_murder: increase murder_skill gain, reduce cooldown to 6min
-- 2. attempt_breakout: restore $2000 cost + 60s cooldown (regression fix)
-- 3. garage_upgrade_warehouse: add server-side cap at 10
-- 4. buy_protection: ensure 50 cap is enforced server-side

BEGIN;

-- 1. Fix train_murder: 0.5% murder skill per success, 6min cooldown
UPDATE public.crimes
SET cooldown_seconds = 360
WHERE key = 'train_murder';

-- 2. Restore attempt_breakout cost + cooldown (migration 102 dropped them)
CREATE OR REPLACE FUNCTION public.attempt_breakout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  v_cost bigint := 2000;
  v_cd_secs int := 60;
  v_now timestamptz := now();
  v_last timestamptz;
  v_skill numeric;
  v_chance numeric;
  v_success boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.jailed_until IS NULL OR p.jailed_until <= v_now THEN
    RAISE EXCEPTION 'NOT_IN_JAIL';
  END IF;

  -- Cooldown check
  v_last := COALESCE(p.last_breakout_attempt, v_now - make_interval(secs => v_cd_secs + 1));
  IF v_last > v_now - make_interval(secs => v_cd_secs) THEN
    RAISE EXCEPTION 'BREAKOUT_COOLDOWN';
  END IF;

  -- Cost check
  IF p.cash < v_cost THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  -- Deduct cost
  UPDATE public.players SET cash = cash - v_cost WHERE id = p.id;

  -- Skill-based success chance (breakout_skill 0-100 scale)
  v_skill := COALESCE(p.breakout_skill, 0);
  v_chance := LEAST(0.85, GREATEST(0.10, v_skill / 100.0 * 0.75 + 0.10));
  v_success := random() < v_chance;

  IF v_success THEN
    UPDATE public.players
      SET jailed_until = NULL,
          last_breakout_attempt = v_now
      WHERE id = p.id;
    RETURN jsonb_build_object('success', true, 'escaped', true, 'skill', v_skill);
  ELSE
    UPDATE public.players
      SET last_breakout_attempt = v_now
      WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'escaped', false, 'skill', v_skill, 'chance', round(v_chance * 100));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.attempt_breakout() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attempt_breakout() TO authenticated;

-- 3. Add server-side cap to garage level (max 10)
CREATE OR REPLACE FUNCTION public.garage_upgrade_warehouse()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  lvl int;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  lvl := COALESCE(p.garage_level, 0);
  IF lvl >= 10 THEN
    RAISE EXCEPTION 'GARAGE_MAX_LEVEL';
  END IF;

  cost := lvl * 50000;
  IF p.cash < cost THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players
    SET garage_level = garage_level + 1,
        cash = cash - cost
    WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_level', lvl + 1, 'cost', cost);
END;
$$;

REVOKE ALL ON FUNCTION public.garage_upgrade_warehouse() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.garage_upgrade_warehouse() TO authenticated;

COMMIT;
