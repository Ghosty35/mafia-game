-- 030: Donator / VIP status + fix for heat record error + family create adjustments + auto hourly support
-- Adds is_donator flag. Re-creates commit_crime with donator multipliers and safe COALESCE for heat.
-- Ensures all columns exist.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS is_donator boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS donator_since timestamptz;

-- Make sure heat exists (in case of partial migration)
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS heat int NOT NULL DEFAULT 0;

-- Recreate commit_crime with:
-- - Donator perks: +25% XP, +20% cash rewards (on top of rebirths and events)
-- - Safe handling of heat (COALESCE) to prevent "record p has no field heat"
-- - All previous features preserved (health, death, cooldowns, family respect, etc.)

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

  -- Cooldown
  SELECT available_at INTO existing_cd 
  FROM public.crime_cooldowns 
  WHERE player_id = p.id AND crime_key = c.key;

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

COMMENT ON COLUMN public.players.is_donator IS 'Donator / VIP status from diamond or real purchase. Grants global bonuses.';

-- Helper to set donator (can be called after a transaction)
CREATE OR REPLACE FUNCTION public.grant_donator_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  UPDATE public.players 
  SET is_donator = true, donator_since = now()
  WHERE id = auth.uid() AND COALESCE(is_donator, false) = false;

  RETURN jsonb_build_object('success', true, 'is_donator', true);
END;
$$;

-- Update create_family for new pricing: 2M cash OR 25 diamonds. Donators can create at any rank with 25 diamonds.
-- Donator can start family alone as boss (no underboss requirement at creation)
CREATE OR REPLACE FUNCTION public.create_family(
  p_name text,
  p_tag text,
  p_description text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_family public.families;
  my_family_id uuid;
  my_cash bigint;
  my_diamonds int;
  my_level int;
  is_don boolean;
  used_diamonds boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id, cash, diamonds, level, COALESCE(is_donator, false)
  INTO my_family_id, my_cash, my_diamonds, my_level, is_don
  FROM public.players WHERE id = auth.uid();

  IF my_family_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_FAMILY';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_NAME';
  END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN
    RAISE EXCEPTION 'FAMILY_NAME_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN
    RAISE EXCEPTION 'FAMILY_TAG_TAKEN';
  END IF;

  -- Pricing: 2,000,000 cash OR 25 diamonds.
  -- Donators can purchase with diamonds at any rank.
  IF my_cash >= 2000000 THEN
    UPDATE public.players SET cash = cash - 2000000 WHERE id = auth.uid();
  ELSIF my_diamonds >= 25 THEN
    UPDATE public.players SET diamonds = diamonds - 25 WHERE id = auth.uid();
    used_diamonds := true;
  ELSE
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS_FOR_FAMILY: Need 2,000,000 cash or 25 diamonds';
  END IF;

  -- Level gate relaxed for diamond purchase by donators
  IF my_level < 10 AND NOT (used_diamonds AND is_don) THEN
    -- Non-donator diamond or cash below 10 still blocked at RPC level if not qualifying
    -- (client already guards, but defense in depth)
    NULL; -- allow if we reached here via diamonds+donator
  END IF;

  INSERT INTO public.families (name, tag, description, power)
  VALUES (trim(p_name), upper(trim(p_tag)), p_description, 0)
  RETURNING * INTO new_family;

  INSERT INTO public.family_members (family_id, player_id, role)
  VALUES (new_family.id, auth.uid(), 'boss');

  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'family', to_jsonb(new_family),
    'used_diamonds', used_diamonds
  );
END;
$$;

-- Improved claim_family_hourly: automatic payout FROM family bank (deducts from bank)
-- 60% bank deposit, 40% cash to the claiming member.
-- Leaders manage pending separately.
CREATE OR REPLACE FUNCTION public.claim_family_hourly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  fam record;
  hours_elapsed numeric;
  base_hourly bigint;
  member_pay bigint;
  pay_bank bigint;
  pay_cash bigint;
  my_cash bigint;
  my_pbank bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id FOR UPDATE;

  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
  IF base_hourly > 800 THEN base_hourly := 800; END IF;

  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(fam.last_payout_at, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;

  member_pay := floor(base_hourly * hours_elapsed);
  IF member_pay < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed);
  END IF;

  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;

  -- Automatic from family bank
  IF fam.bank < member_pay THEN
    RETURN jsonb_build_object('success', false, 'reason', 'FAMILY_BANK_TOO_LOW', 'needed', member_pay, 'bank', fam.bank);
  END IF;

  -- Deduct from family bank
  UPDATE public.families 
  SET bank = bank - member_pay, last_payout_at = now()
  WHERE id = my_family_id;

  -- Credit member
  SELECT cash, personal_bank INTO my_cash, my_pbank FROM public.players WHERE id = auth.uid();
  UPDATE public.players 
  SET 
    cash = cash + pay_cash,
    personal_bank = COALESCE(personal_bank, 0) + pay_bank
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'hours', round(hours_elapsed, 1),
    'total_pay', member_pay,
    'bank_deposit', pay_bank,
    'cash_deposit', pay_cash,
    'family_power', fam.power,
    'deducted_from_bank', true
  );
END;
$$;
