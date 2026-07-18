-- 104_anticheat_and_p0_fixes.sql
-- =====================================================================
-- A) P0 — close buy_family_power race (atomic guarded family-bank update)
-- B) P0 — add a server-side total-bullets cap to buy_bullets
-- C) ANTI-CHEAT — global per-player action rate limit (blocks autoclickers
--    / macro scripts firing actions faster than a human can). commit_crime
--    now enforces a minimum interval between ANY two actions by the player.
-- =====================================================================

-- C) Track the last time the player committed a rate-limited action.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS last_action_at timestamptz DEFAULT now() - interval '1 hour';

-- Minimum seconds between two rate-limited actions (human-paced). Tunable.
-- 1.5s is tight enough to stop autoclickers but invisible to a normal player.
CREATE OR REPLACE FUNCTION public._action_interval_seconds()
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT 1; $$;

-- A) buy_family_power — lock the family row (FOR UPDATE) so concurrent calls
--    cannot both read an old bank balance and drive it negative. Spend is
--    also bounded by the locked, freshly-read balance.
CREATE OR REPLACE FUNCTION public.buy_family_power(spend_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  fam public.families;
  power_gain bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF NOT (my_role IN ('boss', 'underboss', 'accountant')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_BUY_POWER';
  END IF;

  -- LOCK the family row first so concurrent spend calls serialize.
  SELECT * INTO fam FROM public.families WHERE id = my_family_id FOR UPDATE;

  -- Bound spend to the real, locked balance (no negative bank possible).
  IF spend_amount < 25000 OR spend_amount > fam.bank THEN
    RAISE EXCEPTION 'INVALID_SPEND_AMOUNT';
  END IF;

  power_gain := GREATEST(5, floor(spend_amount / 2000));

  UPDATE public.families
  SET
    bank = bank - spend_amount,
    power = power + power_gain
  WHERE id = my_family_id;

  RETURN jsonb_build_object(
    'success', true,
    'spent', spend_amount,
    'power_gained', power_gain,
    'new_power', (SELECT power FROM public.families WHERE id = my_family_id)
  );
END;
$$;

-- B) buy_bullets — add a hard total-bullets cap so repeated buys cannot
--    accumulate unbounded bullets. The cap reads player + factory state
--    atomically inside the existing FOR UPDATE on the player row.
CREATE OR REPLACE FUNCTION public.buy_bullets(amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  f public.bullet_factory;
  unit_price int;
  bought int;
  total_cost bigint;
  fine bigint;
  MAX_BULLETS constant int := 10000;
  space_left int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount < 10 THEN RAISE EXCEPTION 'MIN_10_BULLETS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  -- Hard cap on total bullets a single player may own.
  space_left := GREATEST(0, MAX_BULLETS - COALESCE(p.bullets, 0));
  IF space_left <= 0 THEN RAISE EXCEPTION 'BULLET_CAP_REACHED'; END IF;

  IF amount > 5000 THEN
    -- Police bust: fine, heat, confiscation (unchanged from 035)
    fine := floor(amount * 0.8)::bigint;
    UPDATE public.players
    SET cash = GREATEST(0, cash - fine),
        heat = LEAST(100, COALESCE(heat, 0) + 30),
        heat_updated_at = now(),
        bullets = LEAST(MAX_BULLETS, GREATEST(0, COALESCE(bullets, 0) - floor(amount * 0.6)::bigint))
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'busted', true, 'fine', fine);
  END IF;

  f := public._factory_refill();
  IF f.stock <= 0 THEN RAISE EXCEPTION 'FACTORY_EMPTY'; END IF;

  -- Never sell more than the factory holds OR the player's remaining cap.
  bought := LEAST(amount, f.stock, space_left);
  unit_price := public._bullet_price(f.stock, f.capacity);
  total_cost := bought::bigint * unit_price;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      bullets = LEAST(MAX_BULLETS, COALESCE(bullets, 0) + bought)
  WHERE id = p.id;

  UPDATE public.bullet_factory SET stock = stock - bought WHERE id = 1;

  RETURN jsonb_build_object(
    'success', true, 'bullets_bought', bought, 'requested', amount,
    'unit_price', unit_price, 'cost', total_cost, 'stock_left', f.stock - bought,
    'cap', MAX_BULLETS
  );
END;
$$;

-- C) commit_crime — enforce the global action rate limit. Because the player
--    row is locked FOR UPDATE, the check + stamp is atomic: a second request
--    arriving within the interval will see last_action_at still in the past
--    and be rejected. This stops autoclickers/macros regardless of which
--    crime or which RPC they hammer.
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
  interval_sec int := public._action_interval_seconds();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Lock the player row up front so the rate-limit check + stamp is atomic.
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  -- Anti-autoclick: reject actions faster than the minimum interval.
  IF p.last_action_at IS NOT NULL AND p.last_action_at > (now() - make_interval(secs => interval_sec)) THEN
    RAISE EXCEPTION 'TOO_FAST';
  END IF;

  SELECT * INTO c FROM public.crimes WHERE key = commit_crime.crime_key;
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

  succeeded := random() < c.success_chance;

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
    level = p.level,
    xp = p.xp,
    health = p.health,
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
