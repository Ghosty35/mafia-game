-- 071_random_events_and_jail_sweep.sql
-- =====================================================================
-- SPOOR D3 — RANDOM EVENTS + JAIL RESTRICTION SWEEP
-- ---------------------------------------------------------------------
-- Random street events (_roll_random_event, internal): after a
-- successful crime/heist or any trip, an 8% roll can trigger:
--   found_wallet     35%  +$500..$5,000 dirty cash
--   informant_tip    25%  -10 heat (a friend tips you off)
--   police_shakedown 25%  +10 heat, fine 2% of pocket cash (min $100)
--   mugging          15%  lose 1-3% of pocket cash (min $100)
-- Cash events only fire when the player has >= $100 on hand; the event
-- rides back in the RPC payload ('event') so the UI can toast it.
-- Feed stays quiet — events are personal.
--
-- Jail sweep — these RPCs now raise IN_JAIL (and DEAD where relevant):
--   attempt_murder (also DEAD), attempt_hit, travel_to_city (also DEAD),
--   buy_drug, sell_drug, post_race, join_race.
-- travel_to_city also gets a city whitelist (closes the audit residual
-- "no city whitelist, arbitrary string") + the event roll.
-- =====================================================================

-- ---------- internal: roll a random street event (caller holds the row lock) ----------
CREATE OR REPLACE FUNCTION public._roll_random_event(p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  p public.players;
  r numeric;
  amount bigint;
BEGIN
  IF random() >= 0.08 THEN RETURN NULL; END IF;

  SELECT * INTO p FROM public.players WHERE id = p_player_id;
  IF p.id IS NULL THEN RETURN NULL; END IF;

  r := random();

  IF r < 0.35 THEN
    -- found a fat wallet: dirty cash
    amount := 500 + floor(random() * 4501)::bigint;
    UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + amount
     WHERE id = p.id;
    RETURN jsonb_build_object('key', 'found_wallet', 'amount', amount);

  ELSIF r < 0.60 THEN
    -- informant tip: shake some heat
    IF COALESCE(p.heat, 0) <= 0 THEN RETURN NULL; END IF;
    UPDATE public.players
       SET heat = GREATEST(0, COALESCE(heat, 0) - 10), heat_updated_at = now()
     WHERE id = p.id;
    RETURN jsonb_build_object('key', 'informant_tip', 'heat_delta', -10);

  ELSIF r < 0.85 THEN
    -- police shakedown: heat + a fine from pocket cash
    IF COALESCE(p.cash, 0) < 100 THEN RETURN NULL; END IF;
    amount := LEAST(p.cash, GREATEST(100, floor(p.cash * 0.02)))::bigint;
    UPDATE public.players
       SET cash = cash - amount,
           heat = LEAST(100, COALESCE(heat, 0) + 10), heat_updated_at = now()
     WHERE id = p.id;
    RETURN jsonb_build_object('key', 'police_shakedown', 'amount', amount, 'heat_delta', 10);

  ELSE
    -- mugged: lose 1-3% of pocket cash
    IF COALESCE(p.cash, 0) < 100 THEN RETURN NULL; END IF;
    amount := LEAST(p.cash, GREATEST(100, floor(p.cash * (0.01 + random() * 0.02))))::bigint;
    UPDATE public.players SET cash = cash - amount WHERE id = p.id;
    RETURN jsonb_build_object('key', 'mugging', 'amount', amount);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._roll_random_event(uuid) FROM public, anon, authenticated;

-- ---------- commit_crime: event roll on success ----------
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
  v_event jsonb;
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

  case c.key
    when 'pickpocket' then risk_multiplier := 1.0;
    when 'rob_store'  then risk_multiplier := 2.5;
    when 'steal_car'  then risk_multiplier := 4.0;
    when 'warehouse_heist' then risk_multiplier := 8.0;
    when 'train_murder' then risk_multiplier := 7.0;
    else risk_multiplier := 3.0;
  end case;

  -- stamina cost scales with how physical the job is (069)
  p.stamina := public._spend_stamina(p.id, greatest(1, ceil(risk_multiplier))::int);

  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));
  succeeded := random() < c.success_chance;

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

  -- random street event on a clean getaway (071)
  if succeeded then
    v_event := public._roll_random_event(p.id);
  end if;

  return jsonb_build_object('success', succeeded, 'reward', reward, 'xp_gained', gained_xp,
    'leveled_up', leveled_up, 'available_at', next_available, 'murder_skill_gained', murder_gain,
    'health_lost', final_loss, 'stamina', p.stamina, 'event', v_event, 'player', to_jsonb(p));
end;
$function$;

-- ---------- commit_heist: event roll on success ----------
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
  v_event jsonb;
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

  SELECT available_at INTO existing_cd FROM public.heist_cooldowns WHERE player_id = p.id AND heist_key = h.key;
  IF existing_cd IS NOT NULL AND existing_cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;

  -- heists are physical work (069)
  p.stamina := public._spend_stamina(p.id, 15);

  final_crew := LEAST(GREATEST(crew_size, 2), 3);

  bullets_spent := GREATEST(0, LEAST(COALESCE(bullets_used, 0), 500));
  IF COALESCE(p.bullets, 0) < bullets_spent THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
  bullet_bonus := LEAST(15, bullets_spent / 10.0);

  weapon_bonus  := public._weapon_bonus(weapon);
  getaway_bonus := LEAST(10, floor(car.condition / 12.0) + CASE WHEN car.tuned THEN 2 ELSE 0 END);

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
    v_event := public._roll_random_event(p.id);
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'stamina', p.stamina, 'event', v_event,
    'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

-- ---------- travel_to_city: whitelist + jail/death + event roll ----------
CREATE OR REPLACE FUNCTION public.travel_to_city(city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  cost bigint := 380;
  v_event jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF city NOT IN ('New York', 'Chicago', 'Los Angeles', 'Miami', 'Las Vegas') THEN
    RAISE EXCEPTION 'UNKNOWN_CITY';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.current_city = city THEN RAISE EXCEPTION 'ALREADY_THERE'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - cost, current_city = city
  WHERE id = p.id;

  -- the road is full of surprises (071)
  v_event := public._roll_random_event(p.id);

  RETURN jsonb_build_object('success', true, 'city', city, 'cost', cost, 'event', v_event);
END;
$$;

-- ---------- attempt_murder: add IN_JAIL + DEAD checks ----------
CREATE OR REPLACE FUNCTION public.attempt_murder(target_username text, weapon text, bullets_used integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  attacker_level int;
  attacker_skill numeric;
  stat_edge numeric;
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

  -- jail sweep (071)
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;

  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);

  IF attacker_level < 16 OR attacker_skill < 10 THEN
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;

  attacker.stamina := public._spend_stamina(attacker.id, 15);

  attacker.bullets := GREATEST(0, COALESCE(attacker.bullets, 0) - bullets_used);

  -- bodyguard takes the bullet (070): bullets are spent, shorter cooldown
  IF COALESCE(target.bodyguards, 0) > 0 THEN
    UPDATE public.players SET bodyguards = bodyguards - 1 WHERE id = target.id;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 10);
    cooldown_end := now() + interval '10 minutes';
    attacker.murder_cooldown := cooldown_end;
    UPDATE public.players SET
      heat = attacker.heat, heat_updated_at = now(),
      bullets = attacker.bullets, murder_cooldown = attacker.murder_cooldown
    WHERE id = attacker.id;
    RETURN jsonb_build_object(
      'success', false, 'blocked', true, 'stolen', 0,
      'guards_left', COALESCE(target.bodyguards, 0) - 1,
      'cooldown_until', cooldown_end, 'stamina', attacker.stamina,
      'player', to_jsonb(attacker)
    );
  END IF;

  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));
  IF attacker_skill >= 15 THEN success_chance := success_chance + 15; END IF;
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;
  success_chance := success_chance + LEAST(20, bullets_used / 25);
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;

  succeeded := random() < (success_chance / 100);

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
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
END;
$function$;

-- ---------- attempt_hit: add IN_JAIL check ----------
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
  -- jail sweep (071)
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN
    RAISE EXCEPTION 'IN_JAIL';
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

-- ---------- buy_drug: add IN_JAIL check ----------
CREATE OR REPLACE FUNCTION public.buy_drug(p_drug text, p_qty int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  unit_price int;
  cost bigint;
  tax bigint;
  total bigint;
  have int;
  cap int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  -- jail sweep (071)
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  unit_price := public._drug_price(p.current_city, p_drug);
  cost  := unit_price::bigint * p_qty;
  tax   := floor(cost * 0.015)::bigint;   -- 1.5% Community Tax Fund
  total := cost + tax;

  IF p.cash < total THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  cap  := public._drug_cap(p_drug);
  IF have + p_qty > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  new_storage := jsonb_set(
    COALESCE(p.drug_storage, '{}'::jsonb),
    ARRAY[p_drug],
    to_jsonb(have + p_qty)
  );

  UPDATE public.players
  SET cash = cash - total,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      drug_storage = new_storage
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty,
                            'unit_price', unit_price, 'tax', tax, 'total', total,
                            'storage', new_storage);
END;
$$;

-- ---------- sell_drug: add IN_JAIL check ----------
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
  -- jail sweep (071)
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;
  unit_price := public._drug_price(p.current_city, p_drug);
  revenue := unit_price::bigint * p_qty;
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[p_drug], to_jsonb(have - p_qty));
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + revenue, drug_storage = new_storage WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty, 'unit_price', unit_price, 'revenue', revenue, 'storage', new_storage);
END;
$function$;

-- ---------- post_race: add IN_JAIL check ----------
CREATE OR REPLACE FUNCTION public.post_race(car_name text, bet bigint, expire_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fee bigint;
  new_race_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF bet < 100 OR bet > 1000000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  -- jail sweep (071)
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  fee := GREATEST(100, floor(bet * 0.1))::bigint;
  IF p.cash < fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - fee WHERE id = p.id;

  INSERT INTO public.races (poster_id, poster_name, car_name, bet, entry_fee, expire_at)
  VALUES (p.id, p.username, car_name, bet, fee, now() + make_interval(mins => GREATEST(5, LEAST(240, expire_minutes))))
  RETURNING id INTO new_race_id;

  PERFORM public.log_event('race', COALESCE(p.username, 'Someone') || ' posted a $' || bet || ' street race!');

  RETURN jsonb_build_object('success', true, 'race_id', new_race_id, 'entry_fee', fee);
END;
$$;

-- ---------- join_race: add IN_JAIL check ----------
CREATE OR REPLACE FUNCTION public.join_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  r public.races;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;

  -- jail sweep (071)
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'RACE_NOT_OPEN'; END IF;
  IF r.poster_id = p.id THEN RAISE EXCEPTION 'CANNOT_JOIN_OWN_RACE'; END IF;
  IF r.expire_at IS NOT NULL AND r.expire_at < now() THEN RAISE EXCEPTION 'RACE_EXPIRED'; END IF;
  IF p.cash < r.entry_fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - r.entry_fee WHERE id = p.id;

  UPDATE public.races
  SET joined_by = p.id, joined_name = p.username, status = 'ready'
  WHERE id = race_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
