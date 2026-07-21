-- 162_login_bonus_daily_tasks.sql
-- Daily task prerequisite for login bonus claims.
-- Players must complete a short daily task (crimes / heists / pickpockets)
-- before they can claim the login bonus reward.

BEGIN;

-- Daily task tracker: one row per player, reset each UTC day.
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('crime_count', 'heist_count', 'pickpocket_count')),
  progress int NOT NULL DEFAULT 0,
  target int NOT NULL,
  reset_date date NOT NULL DEFAULT CURRENT_DATE
);

-- Bump daily task progress for a given action.
-- Called from commit_crime / commit_heist on success.
CREATE OR REPLACE FUNCTION public.bump_daily_task(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_player_id uuid;
  v_task_type text;
  v_target int;
  v_reset date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  v_player_id := auth.uid();

  SELECT task_type, target, reset_date
    INTO v_task_type, v_target, v_reset
    FROM public.daily_tasks
   WHERE player_id = v_player_id;

  IF NOT FOUND OR v_reset IS DISTINCT FROM CURRENT_DATE THEN
    RETURN;
  END IF;

  IF p_action = 'crime' AND v_task_type = 'crime_count' THEN
    UPDATE public.daily_tasks
       SET progress = progress + 1
     WHERE player_id = v_player_id;
  ELSIF p_action = 'heist' AND v_task_type = 'heist_count' THEN
    UPDATE public.daily_tasks
       SET progress = progress + 1
     WHERE player_id = v_player_id;
  ELSIF p_action = 'pickpocket' AND v_task_type = 'pickpocket_count' THEN
    UPDATE public.daily_tasks
       SET progress = progress + 1
     WHERE player_id = v_player_id;
  END IF;
END;
$$;

-- Assign or retrieve today's task for the player.
CREATE OR REPLACE FUNCTION public.get_daily_task()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_player_id uuid;
  v_task_type text;
  v_progress int;
  v_target int;
  v_reset date;
  v_done boolean;
  v_label text;
  v_desc text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  v_player_id := auth.uid();

  SELECT task_type, progress, target, reset_date
    INTO v_task_type, v_progress, v_target, v_reset
    FROM public.daily_tasks
   WHERE player_id = v_player_id;

  IF NOT FOUND OR v_reset IS DISTINCT FROM CURRENT_DATE THEN
    v_task_type := CASE floor(random() * 3)::int
      WHEN 0 THEN 'crime_count'
      WHEN 1 THEN 'heist_count'
      ELSE 'pickpocket_count'
    END;

    IF v_task_type = 'crime_count' THEN
      v_target := 3 + floor(random() * 6)::int;
    ELSIF v_task_type = 'heist_count' THEN
      v_target := 1 + floor(random() * 3)::int;
    ELSE
      v_target := 5 + floor(random() * 6)::int;
    END IF;

    INSERT INTO public.daily_tasks (player_id, task_type, progress, target, reset_date)
    VALUES (v_player_id, v_task_type, 0, v_target, CURRENT_DATE)
    ON CONFLICT (player_id) DO UPDATE
      SET task_type = EXCLUDED.task_type,
          progress = 0,
          target = EXCLUDED.target,
          reset_date = EXCLUDED.reset_date;

    v_progress := 0;
    v_reset := CURRENT_DATE;
  END IF;

  v_done := v_progress >= v_target;

  IF v_task_type = 'crime_count' THEN
    v_label := 'Crimes';
    v_desc := v_progress || ' / ' || v_target || ' successful crimes';
  ELSIF v_task_type = 'heist_count' THEN
    v_label := 'Heists';
    v_desc := v_progress || ' / ' || v_target || ' heists completed';
  ELSE
    v_label := 'Pickpockets';
    v_desc := v_progress || ' / ' || v_target || ' successful pickpockets';
  END IF;

  RETURN jsonb_build_object(
    'task_type', v_task_type,
    'label', v_label,
    'description', v_desc,
    'progress', v_progress,
    'target', v_target,
    'completed', v_done
  );
END;
$$;

-- Extend get_login_bonus with daily task gating.
CREATE OR REPLACE FUNCTION public.get_login_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  p          public.players;
  v_claimed  boolean;
  v_streak   int;
  v_next_day int;
  v_reward   jsonb;
  v_task     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END if;
  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  v_claimed := (p.last_login_bonus IS NOT NULL AND p.last_login_bonus::date = CURRENT_DATE);

  IF v_claimed THEN
    v_streak := p.login_streak;
  ELSIF p.last_login_bonus IS NOT NULL AND p.last_login_bonus::date = CURRENT_DATE - 1 THEN
    v_streak := p.login_streak + 1;
  ELSE
    v_streak := 1;
  END IF;

  v_next_day := ((greatest(v_streak, 1) - 1) % 7) + 1;
  v_reward := public._login_bonus_reward(v_next_day);
  IF p.is_donator THEN
    v_reward := jsonb_build_object(
      'cash', floor((v_reward->>'cash')::bigint * 1.5)::bigint,
      'diamonds', (v_reward->>'diamonds')::int
    );
  END IF;

  v_task := public.get_daily_task();

  RETURN jsonb_build_object(
    'streak', p.login_streak,
    'claimable', NOT v_claimed AND (v_task->>'completed')::boolean,
    'claimed_today', v_claimed,
    'day_in_cycle', v_next_day,
    'reward', v_reward,
    'is_donator', p.is_donator,
    'last_claim', p.last_login_bonus,
    'daily_task', v_task
  );
END;
$$;

-- Claim only allowed if daily task is completed.
CREATE OR REPLACE FUNCTION public.claim_login_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  p          public.players;
  v_streak   int;
  v_day      int;
  v_reward   jsonb;
  v_cash     bigint;
  v_diamonds int;
  v_task     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.last_login_bonus IS NOT NULL AND p.last_login_bonus::date = CURRENT_DATE THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED';
  END IF;

  v_task := public.get_daily_task();
  IF NOT (v_task->>'completed')::boolean THEN
    RAISE EXCEPTION 'TASK_NOT_COMPLETE';
  END IF;

  IF p.last_login_bonus IS NOT NULL AND p.last_login_bonus::date = CURRENT_DATE - 1 THEN
    v_streak := p.login_streak + 1;
  ELSE
    v_streak := 1;
  END IF;

  v_day := ((v_streak - 1) % 7) + 1;
  v_reward := public._login_bonus_reward(v_day);
  v_cash := (v_reward->>'cash')::bigint;
  v_diamonds := (v_reward->>'diamonds')::int;
  IF p.is_donator THEN
    v_cash := floor(v_cash * 1.5)::bigint;
  END IF;

  UPDATE public.players
     SET cash = cash + v_cash,
         diamonds = COALESCE(diamonds, 0) + v_diamonds,
         login_streak = v_streak,
         last_login_bonus = now()
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', true,
    'streak', v_streak,
    'day_in_cycle', v_day,
    'cash', v_cash,
    'diamonds', v_diamonds,
    'new_cash', p.cash + v_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bump_daily_task(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bump_daily_task(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_daily_task() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_task() TO authenticated;
REVOKE ALL ON FUNCTION public.get_login_bonus() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_login_bonus() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_login_bonus() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_login_bonus() TO authenticated;

COMMIT;
