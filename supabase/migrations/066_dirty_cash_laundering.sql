-- 066_dirty_cash_laundering.sql
-- =====================================================================
-- SPOOR E — DIRTY CASH + LAUNDERING (hardcore split)
-- ---------------------------------------------------------------------
-- All criminal income now pays out DIRTY cash (players.dirty_cash):
--   commit_crime, commit_heist, rip_player, attempt_murder, attempt_hit,
--   run_race (winnings). Legit income stays clean: property income,
--   family payout, casino/lottery winnings, stock/car sales, refunds.
-- Dirty cash can't be banked/spent — it must be laundered:
--   launder_cash(channel, amount):
--     laundromat  lvl 0   fee 30%  cap  $5M / 24h (rolling)
--     casino      lvl 10  fee 18%  cap $10M / 24h
--     offshore    lvl 25  fee 10%  cap $25M / 24h
--   Bust risk = heat/300 (halved with Corrupt Lawyer). Bust = the batch
--   is confiscated + 20 heat (and it still consumes capacity). A bust
--   emits a feed event; successful washes stay quiet.
-- =====================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS dirty_cash bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.launder_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  channel text NOT NULL,
  amount bigint NOT NULL,
  busted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launder_history_player_time
  ON public.launder_history (player_id, created_at DESC);
-- RLS on, no policies: only reachable via the DEFINER RPCs below.
ALTER TABLE public.launder_history ENABLE ROW LEVEL SECURITY;

-- ---------- channel catalog helper ----------
CREATE OR REPLACE FUNCTION public._launder_channel(p_channel text,
  OUT min_level int, OUT fee_pct numeric, OUT daily_cap bigint)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  CASE p_channel
    WHEN 'laundromat' THEN min_level := 0;  fee_pct := 0.30; daily_cap := 5000000;
    WHEN 'casino'     THEN min_level := 10; fee_pct := 0.18; daily_cap := 10000000;
    WHEN 'offshore'   THEN min_level := 25; fee_pct := 0.10; daily_cap := 25000000;
    ELSE RAISE EXCEPTION 'UNKNOWN_CHANNEL';
  END CASE;
END;
$$;

-- ---------- launder ----------
CREATE OR REPLACE FUNCTION public.launder_cash(p_channel text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  ch record;
  used_24h bigint;
  bust_chance numeric;
  busted boolean;
  fee bigint;
  cleaned bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount IS NULL OR p_amount < 100 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO ch FROM public._launder_channel(p_channel);

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF COALESCE(p.level, 1) < ch.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;
  IF COALESCE(p.dirty_cash, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_DIRTY_CASH'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO used_24h
  FROM public.launder_history
  WHERE player_id = p.id AND channel = p_channel AND created_at > now() - interval '24 hours';
  IF used_24h + p_amount > ch.daily_cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  -- Bust risk scales with heat; the Corrupt Lawyer halves it.
  bust_chance := COALESCE(p.heat, 0) / 300.0;
  IF COALESCE(p.has_corrupt_lawyer, false) THEN bust_chance := bust_chance / 2; END IF;
  busted := random() < bust_chance;

  INSERT INTO public.launder_history (player_id, channel, amount, busted)
  VALUES (p.id, p_channel, p_amount, busted);

  IF busted THEN
    UPDATE public.players
       SET dirty_cash = dirty_cash - p_amount,
           heat = LEAST(100, COALESCE(heat, 0) + 20),
           heat_updated_at = now()
     WHERE id = p.id;
    PERFORM public._log_event_named(p.username, 'bust',
      'got busted laundering $' || p_amount || ' — the feds took everything!');
    RETURN jsonb_build_object('success', false, 'busted', true, 'lost', p_amount,
      'new_heat', LEAST(100, COALESCE(p.heat, 0) + 20));
  END IF;

  fee := FLOOR(p_amount * ch.fee_pct);
  cleaned := p_amount - fee;
  UPDATE public.players
     SET dirty_cash = dirty_cash - p_amount,
         cash = cash + cleaned
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'busted', false, 'washed', p_amount,
    'fee', fee, 'cleaned', cleaned, 'new_cash', p.cash + cleaned,
    'new_dirty', COALESCE(p.dirty_cash, 0) - p_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.launder_cash(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.launder_cash(text, bigint) TO authenticated;

-- ---------- laundering status for the UI ----------
CREATE OR REPLACE FUNCTION public.get_my_laundering()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  result jsonb := '[]'::jsonb;
  ch record;
  used bigint;
  k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  FOREACH k IN ARRAY ARRAY['laundromat','casino','offshore'] LOOP
    SELECT * INTO ch FROM public._launder_channel(k);
    SELECT COALESCE(SUM(amount), 0) INTO used
    FROM public.launder_history
    WHERE player_id = p.id AND channel = k AND created_at > now() - interval '24 hours';
    result := result || jsonb_build_object(
      'key', k, 'min_level', ch.min_level, 'fee_pct', ch.fee_pct,
      'daily_cap', ch.daily_cap, 'used_24h', used,
      'unlocked', COALESCE(p.level, 1) >= ch.min_level);
  END LOOP;

  RETURN jsonb_build_object('dirty_cash', COALESCE(p.dirty_cash, 0), 'channels', result);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_laundering() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_laundering() TO authenticated;

-- =====================================================================
-- INCOME SWEEP: criminal gains now pay dirty_cash
-- =====================================================================

-- ---------- rip_player: stolen goes to the attacker's dirty stack ----------
CREATE OR REPLACE FUNCTION public.rip_player(target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  attacker public.players;
  target   public.players;
  cd timestamptz;
  lvl_diff int;
  success_chance numeric;
  succeeded boolean;
  pct numeric;
  stolen bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF attacker.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  SELECT * INTO target FROM public.players WHERE username = target_username FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target.id = attacker.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF target.death_until IS NOT NULL AND target.death_until > now() THEN RAISE EXCEPTION 'TARGET_DEAD'; END IF;
  IF target.kill_protected_until IS NOT NULL AND target.kill_protected_until > now() THEN RAISE EXCEPTION 'TARGET_PROTECTED'; END IF;
  IF COALESCE(target.cash, 0) < 100 THEN RAISE EXCEPTION 'TARGET_NO_CASH'; END IF;

  SELECT available_at INTO cd FROM public.rip_cooldowns
   WHERE attacker_id = attacker.id AND target_id = target.id;
  IF cd IS NOT NULL AND cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;

  lvl_diff := COALESCE(attacker.level, 1) - COALESCE(target.level, 1);
  success_chance := LEAST(90, GREATEST(20, 60 + lvl_diff * 3));
  succeeded := random() < (success_chance / 100.0);

  IF succeeded THEN
    pct := 0.10 + random() * 0.10;
    stolen := GREATEST(1, FLOOR(target.cash * pct));
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 5);
    UPDATE public.players SET cash = GREATEST(0, cash - stolen) WHERE id = target.id;
    UPDATE public.players
       SET dirty_cash = COALESCE(dirty_cash, 0) + stolen,
           heat = attacker.heat, heat_updated_at = now()
     WHERE id = attacker.id;
    PERFORM public.log_event('rip', 'ripped ' || target.username || ' for $' || stolen || '!');
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 15);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
  END IF;

  INSERT INTO public.rip_cooldowns (attacker_id, target_id, available_at)
  VALUES (attacker.id, target.id, now() + interval '4 seconds')
  ON CONFLICT (attacker_id, target_id) DO UPDATE SET available_at = excluded.available_at;

  RETURN jsonb_build_object(
    'success', succeeded, 'stolen', stolen, 'target', target.username,
    'success_chance', ROUND(success_chance),
    'new_dirty', COALESCE(attacker.dirty_cash, 0) + CASE WHEN succeeded THEN stolen ELSE 0 END,
    'new_heat', attacker.heat
  );
END;
$function$;

-- ---------- commit_crime: reward -> dirty ----------
CREATE OR REPLACE FUNCTION public.commit_crime(crime_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  p public.players;
  c public.crimes;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  succeeded boolean;
  mult numeric;
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
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into c from public.crimes where key = commit_crime.crime_key;
  if c.key is null then raise exception 'UNKNOWN_CRIME'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.level < c.min_level then raise exception 'LEVEL_TOO_LOW'; end if;

  select available_at into existing_cd from public.crime_cooldowns where player_id = p.id and crime_key = c.key;
  if existing_cd is not null and existing_cd > now() then raise exception 'ON_COOLDOWN'; end if;

  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));
  succeeded := random() < c.success_chance;

  case c.key
    when 'pickpocket' then risk_multiplier := 1.0;
    when 'rob_store'  then risk_multiplier := 2.5;
    when 'steal_car'  then risk_multiplier := 4.0;
    when 'warehouse_heist' then risk_multiplier := 8.0;
    when 'train_murder' then risk_multiplier := 7.0;
    else risk_multiplier := 3.0;
  end case;

  health_loss := ceil(2 * risk_multiplier);
  if not succeeded then health_loss := health_loss + ceil(4 * risk_multiplier); end if;
  final_loss := greatest(1, health_loss - floor(p.protection * 0.4));
  p.health := greatest(0, p.health - final_loss);

  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.dirty_cash := coalesce(p.dirty_cash, 0) + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
    if c.key = 'train_murder' then
      murder_gain := 0.02; p.murder_skill := p.murder_skill + murder_gain; heat_gain := 15;
    else heat_gain := 3; end if;
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;
    if c.key = 'train_murder' then
      p.jailed_until := now() + make_interval(secs => 300); heat_gain := 25;
    else
      p.jailed_until := now() + make_interval(secs => c.jail_seconds); heat_gain := 12;
    end if;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;

  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed; p.level := p.level + 1; leveled_up := true; xp_needed := p.level * 100;
  end loop;

  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key) do update set available_at = excluded.available_at;

  update public.players
  set dirty_cash = p.dirty_cash, level = p.level, xp = p.xp, health = p.health,
      jailed_until = p.jailed_until, heat = p.heat, heat_updated_at = now(),
      murder_skill = p.murder_skill, crimes_succeeded = p.crimes_succeeded, crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object('success', succeeded, 'reward', reward, 'xp_gained', gained_xp,
    'leveled_up', leveled_up, 'available_at', next_available, 'murder_skill_gained', murder_gain,
    'health_lost', final_loss, 'player', to_jsonb(p));
end;
$function$;

-- ---------- commit_heist: reward -> dirty ----------
CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size integer, bullets_used integer DEFAULT 0, weapon text DEFAULT NULL::text, car_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  p public.players;
  h record;
  car public.player_cars;
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF weapon IS NULL OR btrim(weapon) = '' THEN RAISE EXCEPTION 'WEAPON_REQUIRED'; END IF;
  IF car_id IS NULL THEN RAISE EXCEPTION 'CAR_REQUIRED'; END IF;

  SELECT * INTO h FROM public.heists WHERE key = heist_key;
  IF h.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_HEIST'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF NOT (COALESCE(p.weapons, '[]'::jsonb) ? weapon) THEN RAISE EXCEPTION 'WEAPON_NOT_OWNED'; END IF;

  SELECT * INTO car FROM public.player_cars WHERE id = car_id AND player_id = p.id FOR UPDATE;
  IF car.id IS NULL THEN RAISE EXCEPTION 'CAR_NOT_OWNED'; END IF;

  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.level < h.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;

  final_crew := LEAST(GREATEST(crew_size, 2), 3);

  bullets_spent := GREATEST(0, LEAST(COALESCE(bullets_used, 0), 500));
  IF COALESCE(p.bullets, 0) < bullets_spent THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
  bullet_bonus := LEAST(15, bullets_spent / 10.0);

  weapon_bonus  := public._weapon_bonus(weapon);
  getaway_bonus := LEAST(10, floor(car.condition / 12.0) + CASE WHEN car.tuned THEN 2 ELSE 0 END);

  SELECT available_at INTO existing_cd FROM public.heist_cooldowns WHERE player_id = p.id AND heist_key = h.key;
  IF existing_cd IS NOT NULL AND existing_cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;

  cooldown_mult := GREATEST(0.5, 1 - (p.rebirths * 0.1));
  IF p.heist_gear IS NOT NULL THEN
    gear_bonus := COALESCE((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  ELSE
    gear_bonus := p.protection * 0.6;
  END IF;

  crew_bonus := (final_crew - 1) * 10;
  base_success := h.base_success;
  total_success := LEAST(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100)
    + (bullet_bonus / 100) + (weapon_bonus / 100) + (getaway_bonus / 100) - (p.heat / 250.0));

  succeeded := random() < total_success;

  p.bullets := COALESCE(p.bullets, 0) - bullets_spent;

  IF succeeded THEN
    health_loss := 1 + random() * 2;
    reward := ((h.min_reward + FLOOR(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := FLOOR(h.xp * (1 + p.rebirths * 0.25));
    p.dirty_cash := COALESCE(p.dirty_cash, 0) + reward;
    p.power := p.power + FLOOR(reward / 20);
    heat_gain := 6;
  ELSE
    health_loss := 5 + random() * 10;
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 18;
  END IF;

  p.health := GREATEST(0, p.health - health_loss);
  IF p.health <= 0 THEN
    p.death_until := now() + make_interval(secs => 3600);
    p.health := 0;
  END IF;

  p.xp := p.xp + gained_xp;
  p.heat := LEAST(100, p.heat + heat_gain);

  DECLARE xp_needed bigint := p.level * 100;
  BEGIN
    WHILE p.xp >= xp_needed LOOP
      p.xp := p.xp - xp_needed; p.level := p.level + 1; xp_needed := p.level * 100;
    END LOOP;
  END;

  UPDATE public.player_cars SET condition = GREATEST(0, condition - 8) WHERE id = car.id;

  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players SET dirty_cash = p.dirty_cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, heat_updated_at = now(), bullets = p.bullets WHERE id = p.id;

  IF succeeded THEN
    PERFORM public.log_event('heist', 'pulled off the ' || replace(h.key, '_', ' ') || ' for $' || reward || '!');
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

-- ---------- attempt_murder: stolen -> dirty ----------
CREATE OR REPLACE FUNCTION public.attempt_murder(target_username text, weapon text, bullets_used integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  attacker_level int;
  attacker_skill numeric;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.05;
  heat_gain int := 20;
  cooldown_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.players WHERE username = target_username FOR UPDATE;

  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF attacker.id = target.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;

  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);

  IF attacker_level < 16 OR attacker_skill < 10 THEN
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;

  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));
  IF attacker_skill >= 15 THEN success_chance := success_chance + 15; END IF;
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;
  success_chance := success_chance + LEAST(20, bullets_used / 25);

  succeeded := random() < (success_chance / 100);

  attacker.bullets := GREATEST(0, COALESCE(attacker.bullets, 0) - bullets_used);

  IF succeeded THEN
    stolen := FLOOR(target.cash * 0.2);
    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := COALESCE(attacker.murder_skill, 0) + skill_gain;
    heat_gain := 15;
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain + 10);
  END IF;

  attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '1 hour';
  attacker.murder_cooldown := cooldown_end;

  UPDATE public.players SET
    dirty_cash = attacker.dirty_cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
    heat_updated_at = now(),
    bullets = attacker.bullets,
    murder_cooldown = attacker.murder_cooldown
  WHERE id = attacker.id;

  IF succeeded THEN
    target.cash := GREATEST(0, target.cash - stolen);
    UPDATE public.players SET cash = target.cash WHERE id = target.id;
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded,
    'stolen', COALESCE(stolen, 0),
    'skill_gained', CASE WHEN succeeded THEN skill_gain ELSE 0 END,
    'cooldown_until', cooldown_end,
    'player', to_jsonb(attacker)
  );
END;
$function$;

-- ---------- attempt_hit: stolen -> dirty ----------
CREATE OR REPLACE FUNCTION public.attempt_hit(target_player_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.03;
  health_loss numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF auth.uid() = target_player_id THEN RAISE EXCEPTION 'CANNOT_HIT_SELF'; END IF;

  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.players WHERE id = target_player_id FOR UPDATE;

  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN
    RAISE EXCEPTION 'DEAD';
  END IF;
  IF attacker.kill_protected_until IS NOT NULL AND attacker.kill_protected_until > now() THEN
    RAISE EXCEPTION 'KILL_PROTECTED';
  END IF;

  success_chance := LEAST(0.85, GREATEST(0.15, (attacker.murder_skill + 5) / (target.level + 10) * 0.6 ));
  succeeded := random() < success_chance;

  IF succeeded THEN
    health_loss := 2 + random() * 3;
    stolen := FLOOR(target.cash * 0.15 + random() * 200);
    IF stolen > target.cash THEN stolen := target.cash; END IF;

    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := attacker.murder_skill + skill_gain;
    attacker.heat := LEAST(100, attacker.heat + 15);

    target.cash := target.cash - stolen;
    target.heat := LEAST(100, target.heat + 10);

    UPDATE public.players SET dirty_cash = attacker.dirty_cash, murder_skill = attacker.murder_skill,
      heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
    UPDATE public.players SET cash = target.cash, heat = target.heat WHERE id = target.id;

    RETURN jsonb_build_object('success', true, 'stolen', stolen, 'skill_gained', skill_gain, 'player', to_jsonb(attacker));
  ELSE
    health_loss := 5 + random() * 10;
    attacker.health := GREATEST(0, attacker.health - health_loss);
    attacker.heat := LEAST(100, attacker.heat + 25);

    IF attacker.health <= 0 THEN
      attacker.death_until := now() + make_interval(secs => 3600);
      attacker.kill_protected_until := null;
    END IF;

    attacker.jailed_until := now() + make_interval(secs => 300);

    UPDATE public.players SET health = attacker.health, death_until = attacker.death_until,
      heat = attacker.heat, heat_updated_at = now(), jailed_until = attacker.jailed_until WHERE id = attacker.id;

    RETURN jsonb_build_object('success', false, 'jail_time', 300, 'health_lost', health_loss, 'player', to_jsonb(attacker));
  END IF;
END;
$function$;

-- ---------- run_race: winnings -> dirty (loser still pays clean) ----------
CREATE OR REPLACE FUNCTION public.run_race(race_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r public.races;
  caller uuid;
  poster_wins boolean;
  winner_id uuid;
  loser_id uuid;
  w_name text;
  loser_cash bigint;
  transfer bigint;
BEGIN
  caller := auth.uid();
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.status <> 'ready' THEN RAISE EXCEPTION 'RACE_NOT_READY'; END IF;
  IF caller <> r.poster_id AND caller <> r.joined_by THEN RAISE EXCEPTION 'NOT_YOUR_RACE'; END IF;
  poster_wins := random() < 0.5;
  winner_id := CASE WHEN poster_wins THEN r.poster_id ELSE r.joined_by END;
  loser_id  := CASE WHEN poster_wins THEN r.joined_by ELSE r.poster_id END;
  w_name    := CASE WHEN poster_wins THEN r.poster_name ELSE r.joined_name END;
  SELECT cash INTO loser_cash FROM public.players WHERE id = loser_id FOR UPDATE;
  transfer := LEAST(r.bet, GREATEST(0, COALESCE(loser_cash, 0)));
  UPDATE public.players SET cash = cash - transfer WHERE id = loser_id;
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + transfer WHERE id = winner_id;
  UPDATE public.races SET status = 'finished', winner_name = w_name WHERE id = race_id;
  PERFORM public.log_event('race', COALESCE(w_name, 'Someone') || ' won a $' || transfer || ' street race!');
  RETURN jsonb_build_object('success', true, 'winner', w_name, 'pot', transfer, 'you_won', winner_id = caller);
END;
$function$;

-- ---------- sell_drug: revenue -> dirty ----------
CREATE OR REPLACE FUNCTION public.sell_drug(p_drug text, p_qty integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  p public.players; unit_price int; revenue bigint; have int; new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;
  unit_price := public._drug_price(p.current_city, p_drug);
  revenue := unit_price::bigint * p_qty;
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[p_drug], to_jsonb(have - p_qty));
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + revenue, drug_storage = new_storage WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty, 'unit_price', unit_price, 'revenue', revenue, 'storage', new_storage);
END;
$function$;
