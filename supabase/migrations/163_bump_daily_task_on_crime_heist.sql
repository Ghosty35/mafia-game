-- 163_bump_daily_task_on_crime_heist.sql
-- Hooks daily task progress into commit_crime and commit_heist.
-- On success: bumps crime_count / heist_count / pickpocket_count tasks.

BEGIN;

CREATE OR REPLACE FUNCTION public.commit_crime(p_crime_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  p public.players;
  c public.crimes;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  succeeded boolean;
  mult numeric;
  donator_mult numeric := 1.0;
  reward bigint := 0;
  gained_xp int := 0;
  leveled_up boolean := false;
  xp_needed bigint;
  heat_gain int;
  police_roll numeric;
  extra_jail int := 0;
  murder_gain numeric := 0;
  health_loss int := 0;
  final_loss int := 0;
  risk_multiplier numeric;
  family_respect int := 0;
  interval_sec int := public._action_interval_seconds();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.last_action_at IS NOT NULL AND p.last_action_at > (now() - make_interval(secs => interval_sec)) THEN
    RAISE EXCEPTION 'TOO_FAST';
  END IF;

  SELECT * INTO c FROM public.crimes WHERE key = p_crime_key;
  IF c.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CRIME'; END IF;

  IF COALESCE(p.health, 100) < 25 THEN
    RAISE EXCEPTION 'HEALTH_TOO_LOW';
  END IF;

  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN
    RAISE EXCEPTION 'IN_JAIL';
  END IF;

  IF p.level < c.min_level THEN
    RAISE EXCEPTION 'LEVEL_TOO_LOW';
  END IF;

  SELECT available_at INTO existing_cd
  FROM public.crime_cooldowns cc
  WHERE cc.player_id = p.id AND cc.crime_key = c.key;

  IF existing_cd IS NOT NULL AND existing_cd > now() THEN
    RAISE EXCEPTION 'ON_COOLDOWN';
  END IF;

  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  IF COALESCE(p.is_donator, false) THEN
    donator_mult := 1.20;
    mult := mult * 1.25;
  END IF;

  p.stamina := public._spend_stamina(p.id, greatest(1, ceil(
    CASE c.key
      WHEN 'pickpocket' THEN 1.0
      WHEN 'rob_store'  THEN 2.5
      WHEN 'steal_car'  THEN 4.0
      WHEN 'warehouse_heist' THEN 8.0
      WHEN 'train_murder' THEN 7.0
      ELSE 3.0
    END
  ))::int);

  succeeded := random() < c.success_chance;

  health_loss := ceil(2 * (
    CASE c.key
      WHEN 'pickpocket' THEN 1.0
      WHEN 'rob_store'  THEN 2.5
      WHEN 'steal_car'  THEN 4.0
      WHEN 'warehouse_heist' THEN 8.0
      WHEN 'train_murder' THEN 7.0
      ELSE 3.0
    END
  ));
  IF NOT succeeded THEN
    health_loss := health_loss + ceil(4 * (
      CASE c.key
        WHEN 'pickpocket' THEN 1.0
        WHEN 'rob_store'  THEN 2.5
        WHEN 'steal_car'  THEN 4.0
        WHEN 'warehouse_heist' THEN 8.0
        WHEN 'train_murder' THEN 7.0
        ELSE 3.0
      END
    ));
  END IF;

  final_loss := greatest(1, health_loss - floor(COALESCE(p.protection, 0) * 0.4));
  p.health := greatest(0, COALESCE(p.health, 100) - final_loss);
  p.health := greatest(1, p.health);

  IF succeeded THEN
    reward := floor( ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult * donator_mult) )::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.dirty_cash := COALESCE(p.dirty_cash, 0) + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    PERFORM public.record_hustler_progress('crime', 1);
    PERFORM public.bump_player_stat('crime');

    IF c.key = 'train_murder' THEN
      murder_gain := 0.1;
      p.murder_skill := COALESCE(p.murder_skill, 0) + murder_gain;
      heat_gain := 15;
    ELSE
      heat_gain := 3;
    END IF;

    IF p.family_id IS NOT NULL THEN
      family_respect := 1;
    END IF;

    PERFORM public.bump_daily_task(
      CASE c.key
        WHEN 'pickpocket' THEN 'pickpocket'
        ELSE 'crime'
      END
    );
  ELSE
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;

    IF c.key = 'train_murder' THEN
      p.jailed_until := now() + make_interval(secs => 300);
      heat_gain := 25;
    ELSE
      p.jailed_until := now() + make_interval(secs => c.jail_seconds);
      heat_gain := 12;
    END IF;
  END IF;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, COALESCE(p.heat, 0) + heat_gain);

  IF COALESCE(p.heat, 0) > 25 THEN
    police_roll := random();
    IF police_roll < (p.heat / 180.0) THEN
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    END IF;
  END IF;

  xp_needed := p.level * 100;
  WHILE p.xp >= xp_needed LOOP
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    leveled_up := true;
    xp_needed := p.level * 100;
  END LOOP;

  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  INSERT INTO public.crime_cooldowns (player_id, crime_key, available_at)
  VALUES (p.id, c.key, next_available)
  ON CONFLICT (player_id, crime_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players
  SET
    cash = p.cash,
    dirty_cash = p.dirty_cash,
    level = p.level,
    xp = p.xp,
    health = p.health,
    stamina = p.stamina,
    stamina_updated_at = now(),
    jailed_until = p.jailed_until,
    heat = COALESCE(p.heat, 0),
    murder_skill = COALESCE(p.murder_skill, 0),
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed,
    last_action_at = now()
  WHERE id = p.id;

  IF family_respect > 0 AND p.family_id IS NOT NULL THEN
    UPDATE public.families SET respect = respect + family_respect WHERE id = p.family_id;
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'available_at', next_available,
    'murder_skill_gained', murder_gain,
    'health_lost', final_loss,
    'player', to_jsonb(p),
    'in_family', (p.family_id IS NOT NULL),
    'family_respect_gained', family_respect
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_crime(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.commit_crime(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size integer, bullets_used integer default 0, car_id uuid default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  p public.players;
  h record;
  car public.player_cars;
  wpn public.armory_catalog;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  base_success numeric;
  gear_bonus numeric := 0;
  crew_bonus numeric;
  bullet_bonus numeric := 0;
  weapon_bonus numeric := 0;
  getaway_bonus numeric := 0;
  total_success numeric;
  succeeded boolean;
  reward bigint := 0;
  gained_xp int := 0;
  heat_gain int;
  final_crew int;
  bullets_spent int;
  health_loss numeric;
  v_event jsonb;
  interval_sec int := public._action_interval_seconds();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF car_id IS NULL THEN RAISE EXCEPTION 'CAR_REQUIRED'; END IF;
  SELECT * INTO h FROM public.heists WHERE key = heist_key;
  IF h.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_HEIST'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.last_action_at IS NOT NULL AND p.last_action_at > (now() - make_interval(secs => interval_sec)) THEN
    RAISE EXCEPTION 'TOO_FAST';
  END IF;

  SELECT * INTO wpn FROM public.armory_catalog WHERE key = p.equipped_weapon;
  IF wpn.key IS NULL OR wpn.heist_class IS NULL THEN RAISE EXCEPTION 'WEAPON_REQUIRED'; END IF;

  SELECT * INTO car FROM public.player_cars WHERE id = car_id AND player_id = p.id FOR UPDATE;
  IF car.id IS NULL THEN RAISE EXCEPTION 'CAR_NOT_OWNED'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.level < h.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;
  SELECT available_at INTO existing_cd FROM public.heist_cooldowns WHERE player_id = p.id AND heist_key = h.key;
  IF existing_cd IS NOT NULL AND existing_cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END if;
  p.stamina := public._spend_stamina(p.id, 15);
  final_crew := least(greatest(crew_size, 2), 3);
  bullets_spent := greatest(0, least(coalesce(bullets_used, 0), 500));
  IF coalesce(p.bullets, 0) < bullets_spent THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
  bullet_bonus := least(15, bullets_spent / 10.0);
  weapon_bonus := least(20, wpn.power / 8.0);
  getaway_bonus := least(10, floor(car.condition / 12.0) + case when car.tuned then 2 else 0 end);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));
  IF p.heist_gear IS NOT NULL THEN
    gear_bonus := coalesce((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  ELSE
    gear_bonus := p.protection * 0.6;
  END IF;
  crew_bonus := (final_crew - 1) * 10;
  base_success := h.base_success;
  total_success := least(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100)
    + (bullet_bonus / 100) + (weapon_bonus / 100) + (getaway_bonus / 100) - (p.heat / 250.0));
  succeeded := random() < total_success;
  p.bullets := coalesce(p.bullets, 0) - bullets_spent;
  IF succeeded THEN
    health_loss := 1 + random() * 2;
    reward := ((h.min_reward + floor(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := floor(h.xp * (1 + p.rebirths * 0.25));
    p.dirty_cash := coalesce(p.dirty_cash, 0) + reward;
    p.power := p.power + floor(reward / 20);
    PERFORM public.record_hustler_progress('heist', 1);
    PERFORM public.bump_player_stat('heist');
    heat_gain := 6;
    PERFORM public.bump_daily_task('heist');
  ELSE
    health_loss := 5 + random() * 10;
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 18;
  END IF;
  p.health := greatest(0, p.health - health_loss);
  IF p.health <= 0 THEN
    p.death_until := now() + make_interval(secs => 3600);
    p.health := 0;
  END IF;
  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);
  DECLARE xp_needed bigint := p.level * 100;
  BEGIN
    WHILE p.xp >= xp_needed LOOP
      p.xp := p.xp - xp_needed;
      p.level := p.level + 1;
      xp_needed := p.level * 100;
    END LOOP;
  END;
  UPDATE public.player_cars SET condition = greatest(0, condition - 8) WHERE id = car.id;
  next_available := now() + make_interval(secs => floor(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;
  UPDATE public.players SET dirty_cash = p.dirty_cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, heat_updated_at = now(), bullets = p.bullets, last_action_at = now() WHERE id = p.id;
  IF succeeded THEN
    PERFORM public.log_event('heist', 'pulled off the ' || replace(h.key, '_', ' ') || ' for $' || reward || '!');
    v_event := public._roll_random_event(p.id);
  END IF;
  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', wpn.key, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', round(total_success * 100),
    'available_at', next_available, 'stamina', p.stamina, 'event', v_event,
    'player', to_jsonb(p), 'health_lost', health_lost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_heist(text, integer, integer, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.commit_heist(text, integer, integer, uuid) TO authenticated;

COMMIT;
