-- 069_gym_stamina.sql
-- =====================================================================
-- SPOOR D1 — GYM + STAMINA
-- ---------------------------------------------------------------------
-- Stamina is the new pacing resource for physical actions:
--   * players.stamina 0..100, regenerates lazily (like heat decay) at
--     60/hour (donators 90/hour), anchored on players.stamina_updated_at.
--     Regen is applied in get_my_player (client polls every 15s) and
--     inside _spend_stamina at action time, remainder-preserving.
--   * Costs: crimes = ceil(risk_multiplier) (pickpocket 1 .. warehouse 8),
--     heists 15, rip 10, murder 15, war attacks 10, gym 20/session.
-- The Gym (/gym) trains two new persistent stats:
--   * players.strength — attacker edge in rip/murder (+(str-def)/2 pp,
--     clamped to ±15) and extra war-attack points (floor(str/10)).
--   * players.defense  — resists rip/murder attempts the same way.
--   gym_train(discipline, sessions 1..10): each session costs 20 stamina
--   and $250 + stat*15 (price grows as the stat grows), gains +1 stat.
-- =====================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS stamina int NOT NULL DEFAULT 100;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS stamina_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS strength int NOT NULL DEFAULT 10;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS defense int NOT NULL DEFAULT 10;

-- ---------- regen rate helper ----------
CREATE OR REPLACE FUNCTION public._stamina_regen_rate(is_donator boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT 60.0 * (1 + CASE WHEN is_donator THEN 0.5 ELSE 0 END);
$$;

-- ---------- internal: lazy regen + spend (caller must hold the row lock) ----------
CREATE OR REPLACE FUNCTION public._spend_stamina(p_player_id uuid, p_cost int)
RETURNS int LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  row record;
  rate numeric;
  elapsed_h numeric;
  pts int;
  cur int;
  anchor timestamptz;
BEGIN
  SELECT stamina, stamina_updated_at, is_donator INTO row
  FROM public.players WHERE id = p_player_id;

  cur := COALESCE(row.stamina, 100);
  anchor := COALESCE(row.stamina_updated_at, now());

  IF cur < 100 THEN
    rate := public._stamina_regen_rate(COALESCE(row.is_donator, false));
    elapsed_h := EXTRACT(EPOCH FROM (now() - anchor)) / 3600.0;
    pts := floor(elapsed_h * rate)::int;
    IF pts > 0 THEN
      IF cur + pts >= 100 THEN
        cur := 100; anchor := now();
      ELSE
        cur := cur + pts;
        -- advance the anchor only by the whole points regenerated (keep remainder)
        anchor := anchor + make_interval(secs => floor((pts / rate) * 3600));
      END IF;
    END IF;
  ELSE
    anchor := now();  -- keep anchor fresh while full
  END IF;

  IF cur < p_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_STAMINA'; END IF;
  cur := cur - p_cost;

  UPDATE public.players SET stamina = cur, stamina_updated_at = anchor
  WHERE id = p_player_id;

  RETURN cur;
END;
$$;

REVOKE ALL ON FUNCTION public._spend_stamina(uuid, int) FROM public, anon, authenticated;

-- ---------- get_my_player: lazy heat decay (062) + lazy stamina regen ----------
CREATE OR REPLACE FUNCTION public.get_my_player()
 RETURNS players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p public.players;
  rate numeric;
  elapsed_h numeric;
  points int;
  upd_heat int;
  upd_stamp timestamptz;
  srate numeric;
  spoints int;
  upd_stam int;
  stam_anchor timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  IF p.id IS NULL THEN
    INSERT INTO public.players (id, last_active, heat_updated_at, stamina_updated_at)
    VALUES (auth.uid(), now(), now(), now()) RETURNING * INTO p;
    RETURN p;
  END IF;

  -- heat decay (unchanged from 062)
  upd_heat  := COALESCE(p.heat, 0);
  upd_stamp := COALESCE(p.heat_updated_at, now());

  IF upd_heat > 0 THEN
    rate := public._heat_decay_rate(COALESCE(p.is_donator, false), COALESCE(p.has_corrupt_lawyer, false));
    elapsed_h := EXTRACT(EPOCH FROM (now() - upd_stamp)) / 3600.0;
    points := floor(elapsed_h * rate)::int;
    IF points > 0 THEN
      IF points >= upd_heat THEN
        upd_heat := 0;
        upd_stamp := now();
      ELSE
        upd_heat := upd_heat - points;
        upd_stamp := upd_stamp + make_interval(secs => floor((points / rate) * 3600));
      END IF;
    END IF;
  ELSE
    upd_stamp := now();
  END IF;

  -- stamina regen (069)
  upd_stam    := COALESCE(p.stamina, 100);
  stam_anchor := COALESCE(p.stamina_updated_at, now());

  IF upd_stam < 100 THEN
    srate := public._stamina_regen_rate(COALESCE(p.is_donator, false));
    elapsed_h := EXTRACT(EPOCH FROM (now() - stam_anchor)) / 3600.0;
    spoints := floor(elapsed_h * srate)::int;
    IF spoints > 0 THEN
      IF upd_stam + spoints >= 100 THEN
        upd_stam := 100;
        stam_anchor := now();
      ELSE
        upd_stam := upd_stam + spoints;
        stam_anchor := stam_anchor + make_interval(secs => floor((spoints / srate) * 3600));
      END IF;
    END IF;
  ELSE
    stam_anchor := now();
  END IF;

  UPDATE public.players
     SET heat = upd_heat, heat_updated_at = upd_stamp,
         stamina = upd_stam, stamina_updated_at = stam_anchor,
         last_active = now()
   WHERE id = auth.uid();

  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  RETURN p;
END;
$function$;

-- ---------- gym_train: sessions via input field (no spam clicking) ----------
CREATE OR REPLACE FUNCTION public.gym_train(p_discipline text, p_sessions int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  stat int;
  total_cash bigint := 0;
  i int;
  new_stamina int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_discipline NOT IN ('strength', 'defense') THEN RAISE EXCEPTION 'UNKNOWN_DISCIPLINE'; END IF;
  IF p_sessions IS NULL OR p_sessions < 1 OR p_sessions > 10 THEN RAISE EXCEPTION 'INVALID_SESSIONS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  stat := CASE WHEN p_discipline = 'strength' THEN COALESCE(p.strength, 10) ELSE COALESCE(p.defense, 10) END;

  -- price per session grows with the stat: $250 + stat*15
  FOR i IN 1..p_sessions LOOP
    total_cash := total_cash + 250 + (stat + i - 1) * 15;
  END LOOP;
  IF p.cash < total_cash THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  new_stamina := public._spend_stamina(p.id, 20 * p_sessions);

  IF p_discipline = 'strength' THEN
    UPDATE public.players SET cash = cash - total_cash, strength = stat + p_sessions WHERE id = p.id;
  ELSE
    UPDATE public.players SET cash = cash - total_cash, defense = stat + p_sessions WHERE id = p.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'discipline', p_discipline, 'sessions', p_sessions,
    'gained', p_sessions, 'new_stat', stat + p_sessions, 'cost', total_cash,
    'stamina', new_stamina, 'new_cash', p.cash - total_cash
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gym_train(text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gym_train(text, int) TO authenticated;

-- =====================================================================
-- ACTION SWEEP: consume stamina + apply strength/defense to PvP odds
-- =====================================================================

-- ---------- commit_crime: stamina = ceil(risk_multiplier) ----------
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

  return jsonb_build_object('success', succeeded, 'reward', reward, 'xp_gained', gained_xp,
    'leveled_up', leveled_up, 'available_at', next_available, 'murder_skill_gained', murder_gain,
    'health_lost', final_loss, 'stamina', p.stamina, 'player', to_jsonb(p));
end;
$function$;

-- ---------- commit_heist: 15 stamina ----------
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
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'stamina', p.stamina, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

-- ---------- rip_player: 10 stamina + strength vs defense ----------
CREATE OR REPLACE FUNCTION public.rip_player(target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  attacker public.players;
  target   public.players;
  cd timestamptz;
  lvl_diff int;
  stat_edge numeric;
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

  attacker.stamina := public._spend_stamina(attacker.id, 10);

  lvl_diff := COALESCE(attacker.level, 1) - COALESCE(target.level, 1);
  -- gym stats: attacker strength vs target defense, worth up to ±15pp (069)
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := LEAST(90, GREATEST(20, 60 + lvl_diff * 3 + stat_edge));
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
    'new_heat', attacker.heat, 'stamina', attacker.stamina
  );
END;
$function$;

-- ---------- attempt_murder: 15 stamina + strength vs defense ----------
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

  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;

  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);

  IF attacker_level < 16 OR attacker_skill < 10 THEN
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;

  attacker.stamina := public._spend_stamina(attacker.id, 15);

  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));
  IF attacker_skill >= 15 THEN success_chance := success_chance + 15; END IF;
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;
  success_chance := success_chance + LEAST(20, bullets_used / 25);
  -- gym stats: strength vs defense, worth up to ±15pp (069)
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;

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
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
END;
$function$;

-- ---------- war_attack: 10 stamina + strength bonus points ----------
CREATE OR REPLACE FUNCTION public.war_attack(p_war_id uuid, p_bullets int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  w public.family_wars;
  me public.players;
  side text;
  cd timestamptz;
  pts bigint;
  new_stamina int;
  resolved jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_bullets IS NULL OR p_bullets < 0 OR p_bullets > 100 THEN
    RAISE EXCEPTION 'INVALID_BULLETS';
  END IF;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'WAR_NOT_FOUND'; END IF;
  IF w.state <> 'active' THEN RAISE EXCEPTION 'WAR_OVER'; END IF;

  IF now() >= w.ends_at THEN
    resolved := public._resolve_war(w.id);
    RETURN jsonb_build_object('war_over', true, 'result', resolved);
  END IF;

  SELECT * INTO me FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF me.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF me.death_until IS NOT NULL AND me.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF me.jailed_until IS NOT NULL AND me.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF me.family_id = w.attacker_family_id THEN side := 'attacker';
  ELSIF me.family_id = w.defender_family_id THEN side := 'defender';
  ELSE RAISE EXCEPTION 'NOT_YOUR_WAR';
  END IF;

  -- 60s per-player cooldown for this war
  SELECT last_attack_at INTO cd FROM public.war_contributions
  WHERE war_id = w.id AND player_id = me.id;
  IF cd IS NOT NULL AND now() < cd + interval '60 seconds' THEN
    RAISE EXCEPTION 'ON_COOLDOWN';
  END IF;

  new_stamina := public._spend_stamina(me.id, 10);

  IF p_bullets > 0 THEN
    IF COALESCE(me.bullets, 0) < p_bullets THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
    UPDATE public.players SET bullets = bullets - p_bullets WHERE id = me.id;
  END IF;

  -- strength from the gym adds muscle to the hit (069)
  pts := 5 + FLOOR(COALESCE(me.level, 1) / 2.0) + FLOOR(p_bullets / 4.0)
       + FLOOR(COALESCE(me.strength, 10) / 10.0) + FLOOR(random() * 6);

  IF side = 'attacker' THEN
    UPDATE public.family_wars SET attacker_score = attacker_score + pts WHERE id = w.id;
  ELSE
    UPDATE public.family_wars SET defender_score = defender_score + pts WHERE id = w.id;
  END IF;

  INSERT INTO public.war_contributions (war_id, player_id, family_id, points, attacks, last_attack_at)
  VALUES (w.id, me.id, me.family_id, pts, 1, now())
  ON CONFLICT (war_id, player_id) DO UPDATE
  SET points = war_contributions.points + excluded.points,
      attacks = war_contributions.attacks + 1,
      last_attack_at = now();

  UPDATE public.players
  SET heat = LEAST(100, COALESCE(heat, 0) + 3), heat_updated_at = now()
  WHERE id = me.id;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id;

  RETURN jsonb_build_object(
    'success', true,
    'points', pts,
    'side', side,
    'attacker_score', w.attacker_score,
    'defender_score', w.defender_score,
    'stamina', new_stamina,
    'next_attack_at', now() + interval '60 seconds'
  );
END;
$$;
