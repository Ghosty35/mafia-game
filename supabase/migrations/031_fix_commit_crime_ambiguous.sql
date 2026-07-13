-- 031: Fix "column reference 'crime_key' is ambiguous" error in commit_crime
-- This happened because the function parameter "crime_key" shadowed the column name
-- in the crime_cooldowns table without proper qualification/alias.

-- The error specifically surfaced on pickpocket (and likely other crimes) after recent updates.

CREATE OR REPLACE FUNCTION public.commit_crime(crime_key text)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO c FROM public.crimes WHERE key = commit_crime.crime_key;
  IF c.key IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CRIME';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'NO_PLAYER';
  END IF;

  -- Check if dead
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN
    RAISE EXCEPTION 'IN_JAIL';
  END IF;

  IF p.level < c.min_level THEN
    RAISE EXCEPTION 'LEVEL_TOO_LOW';
  END IF;

  -- Cooldown - use table alias to avoid ambiguity with function parameter "crime_key"
  SELECT available_at INTO existing_cd 
  FROM public.crime_cooldowns cc
  WHERE cc.player_id = p.id AND cc.crime_key = c.key;

  IF existing_cd IS NOT NULL AND existing_cd > now() THEN
    RAISE EXCEPTION 'ON_COOLDOWN';
  END IF;

  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  -- Donator status perks (stacks on top of everything)
  IF COALESCE(p.is_donator, false) THEN
    donator_mult := 1.20;  -- +20% money
    mult := mult * 1.25;   -- +25% XP
  END IF;

  succeeded := random() < c.success_chance;

  -- Health loss (pickpocket low risk)
  CASE c.key
    WHEN 'pickpocket' THEN risk_multiplier := 1.0;
    WHEN 'rob_store'  THEN risk_multiplier := 2.5;
    WHEN 'steal_car'  THEN risk_multiplier := 4.0;
    ELSE risk_multiplier := 3.0;
  END CASE;

  health_loss := ceil(2 * risk_multiplier);
  IF NOT succeeded THEN
    health_loss := health_loss + ceil(4 * risk_multiplier);
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
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    IF c.key = 'train_murder' THEN
      murder_gain := 0.02;
      p.murder_skill := COALESCE(p.murder_skill, 0) + murder_gain;
      heat_gain := 15;
    ELSE
      heat_gain := 3;
    END IF;

    -- Small family respect on success (if in family)
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

  -- Police extra jail on high heat
  IF COALESCE(p.heat, 0) > 25 THEN
    police_roll := random();
    IF police_roll < (p.heat / 180.0) THEN
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    END IF;
  END IF;

  -- Level up
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

  -- Update player (safe with COALESCE for legacy rows)
  UPDATE public.players
  SET
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    health = p.health,
    death_until = p.death_until,
    jailed_until = p.jailed_until,
    heat = COALESCE(p.heat, 0),
    murder_skill = COALESCE(p.murder_skill, 0),
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  WHERE id = p.id;

  -- Award family respect if applicable (lightweight)
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

COMMENT ON FUNCTION public.commit_crime(text) IS 'Fixed version with table alias for crime_cooldowns to resolve "crime_key" ambiguous reference (function param vs column).';
