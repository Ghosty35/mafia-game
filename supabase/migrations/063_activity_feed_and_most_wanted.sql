-- 063_activity_feed_and_most_wanted.sql
-- =====================================================================
-- LIVE ACTIVITY FEED + MOST WANTED LEADERBOARD
-- ---------------------------------------------------------------------
-- The game_events table + log_event/get_recent_events already exist but
-- were barely used (only the race feature emitted events, and the client
-- feed showed fake data). This migration:
--   * adds _log_event_named(username, type, message) so third-person
--     events (e.g. a promotion) can be attributed to the subject, not the
--     actor. Internal-only (called via PERFORM from SECURITY DEFINER fns).
--   * adds get_most_wanted(limit) — a heat-ranked leaderboard (players is
--     RLS owner-read, so a DEFINER RPC is needed to read everyone's heat).
--   * emits real events from: commit_heist (success), _family_set_role
--     (promotion/demotion), join_family, create_family.
-- =====================================================================

-- ---------- named event logger (internal) ----------
CREATE OR REPLACE FUNCTION public._log_event_named(p_username text, p_type text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF p_username IS NULL THEN RETURN; END IF;
  IF length(p_message) > 200 THEN p_message := left(p_message, 200); END IF;
  INSERT INTO public.game_events (username, event_type, message)
  VALUES (p_username, p_type, p_message);
  IF random() < 0.02 THEN
    DELETE FROM public.game_events
    WHERE id NOT IN (SELECT id FROM public.game_events ORDER BY id DESC LIMIT 500);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._log_event_named(text, text, text) FROM public, anon, authenticated;

-- ---------- most wanted leaderboard ----------
CREATE OR REPLACE FUNCTION public.get_most_wanted(limit_count integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH ranked AS (
    SELECT
      p.id, p.username, COALESCE(p.heat, 0) AS heat, p.level, p.cash,
      p.current_city, COALESCE(p.is_donator, false) AS is_donator,
      f.tag AS family_tag,
      row_number() OVER (ORDER BY COALESCE(p.heat,0) DESC, p.level DESC, p.xp DESC) AS pos
    FROM public.players p
    LEFT JOIN public.families f ON f.id = p.family_id
    WHERE p.username IS NOT NULL
  )
  SELECT jsonb_build_object(
    'top', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pos', pos, 'username', username, 'heat', heat, 'level', level,
        'cash', cash, 'city', current_city, 'is_donator', is_donator,
        'family_tag', family_tag
      ) ORDER BY pos), '[]'::jsonb)
      FROM (SELECT * FROM ranked ORDER BY pos LIMIT LEAST(limit_count, 100)) t
    ),
    'me', (
      SELECT jsonb_build_object('pos', pos, 'username', username, 'heat', heat)
      FROM ranked WHERE id = auth.uid()
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_most_wanted(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_most_wanted(integer) TO authenticated;

-- ---------- _family_set_role: emit promotion/demotion event ----------
CREATE OR REPLACE FUNCTION public._family_set_role(p_target_player_id uuid, p_new_role text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  my_family_id uuid; my_role text; target_family_id uuid; target_role text; manager_count int;
  tgt_name text; fam_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_new_role = 'boss' THEN RAISE EXCEPTION 'CANNOT_ASSIGN_BOSS'; END IF;
  IF public._family_rank(p_new_role) < 0 THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF NOT (my_role IN ('boss', 'underboss', 'manager')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_target_player_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  SELECT family_id, role INTO target_family_id, target_role FROM public.family_members WHERE player_id = p_target_player_id;
  IF target_family_id IS NULL OR target_family_id <> my_family_id THEN RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY'; END IF;
  IF my_role = 'manager' AND p_new_role NOT IN ('soldier', 'associate') THEN RAISE EXCEPTION 'MANAGERS_CAN_ONLY_MANAGE_LOWER_ROLES'; END IF;
  IF public._family_rank(my_role) <= public._family_rank(target_role) THEN RAISE EXCEPTION 'CANNOT_MODIFY_EQUAL_OR_HIGHER_RANK'; END IF;
  IF public._family_rank(my_role) <= public._family_rank(p_new_role) THEN RAISE EXCEPTION 'CANNOT_ASSIGN_ROLE_ABOVE_OR_EQUAL_SELF'; END IF;
  IF p_new_role = 'manager' THEN
    SELECT COUNT(*) INTO manager_count FROM public.family_members WHERE family_id = my_family_id AND role = 'manager';
    IF manager_count >= 2 THEN RAISE EXCEPTION 'MAX_2_MANAGERS'; END IF;
  END IF;
  UPDATE public.family_members SET role = p_new_role WHERE family_id = my_family_id AND player_id = p_target_player_id;

  -- Activity feed event (subject = the promoted/demoted member).
  SELECT username INTO tgt_name FROM public.players WHERE id = p_target_player_id;
  SELECT name INTO fam_name FROM public.families WHERE id = my_family_id;
  IF public._family_rank(p_new_role) > public._family_rank(target_role) THEN
    PERFORM public._log_event_named(tgt_name, 'promotion',
      'was promoted to ' || p_new_role || ' in ' || COALESCE(fam_name, 'their family'));
  ELSE
    PERFORM public._log_event_named(tgt_name, 'promotion',
      'was reassigned to ' || p_new_role || ' in ' || COALESCE(fam_name, 'their family'));
  END IF;

  RETURN jsonb_build_object('success', true, 'new_role', p_new_role);
END;
$function$;

-- ---------- join_family: emit event ----------
CREATE OR REPLACE FUNCTION public.join_family(p_family_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  target_family public.families;
  my_family_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is not null then raise exception 'ALREADY_IN_FAMILY'; end if;

  select * into target_family from public.families where id = p_family_id;
  if target_family.id is null then raise exception 'FAMILY_NOT_FOUND'; end if;

  insert into public.family_members (family_id, player_id, role)
  values (p_family_id, auth.uid(), 'soldier');

  update public.players set family_id = p_family_id where id = auth.uid();

  perform public.log_event('family', 'joined ' || COALESCE(target_family.name, 'a family'));

  return to_jsonb(target_family);
end;
$function$;

-- ---------- create_family: emit event ----------
CREATE OR REPLACE FUNCTION public.create_family(p_name text, p_tag text, p_description text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  new_family public.families;
  my_family_id uuid;
  my_cash bigint;
  my_diamonds int;
  my_level int;
  is_don boolean;
  used_diamonds boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id, cash, diamonds, level, COALESCE(is_donator, false)
  INTO my_family_id, my_cash, my_diamonds, my_level, is_don
  FROM public.players WHERE id = auth.uid();

  IF my_family_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_IN_FAMILY'; END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN RAISE EXCEPTION 'INVALID_FAMILY_NAME'; END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN RAISE EXCEPTION 'INVALID_FAMILY_TAG'; END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN RAISE EXCEPTION 'FAMILY_NAME_TAKEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN RAISE EXCEPTION 'FAMILY_TAG_TAKEN'; END IF;

  IF my_cash >= 2000000 THEN
    UPDATE public.players SET cash = cash - 2000000 WHERE id = auth.uid();
  ELSIF my_diamonds >= 25 THEN
    UPDATE public.players SET diamonds = diamonds - 25 WHERE id = auth.uid();
    used_diamonds := true;
  ELSE
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS_FOR_FAMILY';
  END IF;

  IF my_level < 10 AND NOT (used_diamonds AND is_don) THEN RAISE EXCEPTION 'LEVEL_TOO_LOW_FOR_FAMILY'; END IF;

  INSERT INTO public.families (name, tag, description, power, bank, pending_bank)
  VALUES (trim(p_name), upper(trim(p_tag)), p_description, 0, 0, 0)
  RETURNING * INTO new_family;

  INSERT INTO public.family_members (family_id, player_id, role)
  VALUES (new_family.id, auth.uid(), 'boss');

  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  perform public.log_event('family', 'founded the ' || trim(p_name) || ' family');

  RETURN jsonb_build_object('family', to_jsonb(new_family), 'used_diamonds', used_diamonds);
END;
$function$;

-- ---------- commit_heist: emit success event ----------
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
