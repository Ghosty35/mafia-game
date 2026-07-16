-- 062_heat_decay_and_reduction.sql
-- =====================================================================
-- HEAT SYSTEM: passive decay + reduction items + corrupt-lawyer upgrade
-- ---------------------------------------------------------------------
-- Heat previously only ratcheted up. Now:
--   * Heat passively cools while the player isn't committing crimes.
--     Decay is applied lazily in get_my_player (the client polls it every
--     15s), anchored on players.heat_updated_at. Base 30 heat/hour;
--     donators +50%, the Corrupt Lawyer upgrade +50% (max 60/hour).
--   * reduce_heat(item) — server-authoritative consumables:
--       burner  -20 heat  $5,000
--       bribe   -50 heat  $25,000
--       lay_low  ->0 heat $60,000   (also used by the Safehouse "lay low")
--   * buy_corrupt_lawyer() — one-time $250k upgrade, permanent faster decay.
--   * commit_crime / commit_heist now stamp heat_updated_at = now() when
--     they raise heat, so decay restarts from the fresh gain.
-- "Most Wanted" (heat >= 75) is a frontend badge; the existing heat-scaled
--  police jail-roll in commit_crime already makes high heat riskier.
-- =====================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS heat_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS has_corrupt_lawyer boolean NOT NULL DEFAULT false;

-- ---------- decay rate helper ----------
CREATE OR REPLACE FUNCTION public._heat_decay_rate(is_donator boolean, has_lawyer boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT 30.0 * (1
    + CASE WHEN is_donator THEN 0.5 ELSE 0 END
    + CASE WHEN has_lawyer THEN 0.5 ELSE 0 END);
$$;

-- ---------- get_my_player: apply lazy heat decay ----------
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  IF p.id IS NULL THEN
    INSERT INTO public.players (id, last_active, heat_updated_at)
    VALUES (auth.uid(), now(), now()) RETURNING * INTO p;
    RETURN p;
  END IF;

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
        -- advance the anchor only by the whole points consumed (keep remainder)
        upd_stamp := upd_stamp + make_interval(secs => floor((points / rate) * 3600));
      END IF;
    END IF;
  ELSE
    upd_stamp := now();  -- keep anchor fresh while cool
  END IF;

  UPDATE public.players
     SET heat = upd_heat, heat_updated_at = upd_stamp, last_active = now()
   WHERE id = auth.uid();

  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  RETURN p;
END;
$function$;

-- ---------- reduce_heat: consumable heat-reduction items ----------
CREATE OR REPLACE FUNCTION public.reduce_heat(item_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  cost bigint;
  drop_amt int := 0;
  set_zero boolean := false;
  label text;
  new_heat int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  CASE item_key
    WHEN 'burner'  THEN cost := 5000;  drop_amt := 20; label := 'Burner Phone';
    WHEN 'bribe'   THEN cost := 25000; drop_amt := 50; label := 'Bribe a Cop';
    WHEN 'lay_low' THEN cost := 60000; set_zero := true; label := 'Lay Low';
    ELSE RAISE EXCEPTION 'UNKNOWN_HEAT_ITEM';
  END CASE;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF COALESCE(p.heat, 0) <= 0 THEN RAISE EXCEPTION 'NO_HEAT'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  IF set_zero THEN new_heat := 0; ELSE new_heat := GREATEST(0, p.heat - drop_amt); END IF;

  UPDATE public.players
     SET cash = cash - cost, heat = new_heat, heat_updated_at = now()
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'item', item_key, 'label', label,
    'cost', cost, 'new_heat', new_heat, 'new_cash', p.cash - cost);
END;
$function$;

REVOKE ALL ON FUNCTION public.reduce_heat(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reduce_heat(text) TO authenticated;

-- ---------- buy_corrupt_lawyer: permanent faster-decay upgrade ----------
CREATE OR REPLACE FUNCTION public.buy_corrupt_lawyer()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE p public.players; cost constant bigint := 250000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF COALESCE(p.has_corrupt_lawyer, false) THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  UPDATE public.players SET cash = cash - cost, has_corrupt_lawyer = true WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
END;
$function$;

REVOKE ALL ON FUNCTION public.buy_corrupt_lawyer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_corrupt_lawyer() TO authenticated;

-- ---------- commit_crime: stamp heat_updated_at on heat gain ----------
CREATE OR REPLACE FUNCTION public.commit_crime(crime_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into c from public.crimes where key = commit_crime.crime_key;
  if c.key is null then
    raise exception 'UNKNOWN_CRIME';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;

  if p.level < c.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  -- Cooldown
  select available_at into existing_cd
  from public.crime_cooldowns
  where player_id = p.id and crime_key = c.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

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

  if not succeeded then
    health_loss := health_loss + ceil(4 * risk_multiplier);
  end if;

  final_loss := greatest(1, health_loss - floor(p.protection * 0.4));
  p.health := greatest(0, p.health - final_loss);

  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    if c.key = 'train_murder' then
      murder_gain := 0.02;
      p.murder_skill := p.murder_skill + murder_gain;
      heat_gain := 15;
    else
      heat_gain := 3;
    end if;
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;

    if c.key = 'train_murder' then
      p.jailed_until := now() + make_interval(secs => 300);
      heat_gain := 25;
    else
      p.jailed_until := now() + make_interval(secs => c.jail_seconds);
      heat_gain := 12;
    end if;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Police chance (scales with heat)
  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;

  -- Level up
  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    leveled_up := true;
    xp_needed := p.level * 100;
  end loop;

  -- Cooldown
  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key) do update set available_at = excluded.available_at;

  update public.players
  set
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    health = p.health,
    jailed_until = p.jailed_until,
    heat = p.heat,
    heat_updated_at = now(),
    murder_skill = p.murder_skill,
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'available_at', next_available,
    'murder_skill_gained', murder_gain,
    'health_lost', final_loss,
    'player', to_jsonb(p)
  );
end;
$function$;

-- ---------- commit_heist: stamp heat_updated_at on heat gain ----------
CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size integer, bullets_used integer DEFAULT 0, weapon text DEFAULT NULL::text, car_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    p.cash := p.cash + reward;
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
      p.xp := p.xp - xp_needed;
      p.level := p.level + 1;
      xp_needed := p.level * 100;
    END LOOP;
  END;

  UPDATE public.player_cars SET condition = GREATEST(0, condition - 8) WHERE id = car.id;

  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players SET cash = p.cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, heat_updated_at = now(), bullets = p.bullets WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;
