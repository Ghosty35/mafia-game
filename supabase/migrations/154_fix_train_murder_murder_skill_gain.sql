-- 154_fix_train_murder_murder_skill_gain.sql
-- Increase train_murder murder_skill gain from 0.02 to 0.1 per success
-- so players see meaningful progress (0.5% display per successful crime).

CREATE OR REPLACE FUNCTION public.commit_crime(p_crime_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  IF p.death_until IS NOT NULL AND p.death_until > now() THEN
    RAISE EXCEPTION 'DEAD';
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

  IF p.health <= 0 THEN
    p.death_until := now() + make_interval(secs => 3600);
    p.health := 0;
  END IF;

  IF succeeded THEN
    reward := floor( ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult * donator_mult) )::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.dirty_cash := COALESCE(p.dirty_cash, 0) + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    PERFORM public.record_hustler_progress('crime', 1);
    PERFORM public.bump_player_stat('crime');

    IF c.key = 'train_murder' THEN
      murder_gain := 0.1; -- 0.5% display per success (0.1 * 5 = 0.5%)
      p.murder_skill := COALESCE(p.murder_skill, 0) + murder_gain;
      heat_gain := 15;
    ELSE
      heat_gain := 3;
    END IF;

    IF p.family_id IS NOT NULL THEN
      family_respect := 1;
    END IF;
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
    death_until = p.death_until,
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
