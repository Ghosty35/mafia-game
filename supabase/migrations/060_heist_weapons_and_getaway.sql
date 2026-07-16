-- 060_heist_weapons_and_getaway.sql
-- =====================================================================
-- SPOOR D (heists) — verplichte wapens + getaway-driver (auto)
-- ---------------------------------------------------------------------
-- Wapens waren cosmetisch (gratis selector). Nu:
--   * players.weapons = bezeten wapens (jsonb array van ids)
--   * buy_weapon(id)  = koop persistent wapen uit server-catalogus
--   * commit_heist vereist een BEZETEN wapen (weapon) EN een getaway-auto
--     (car_id uit player_cars). Beide geven een slaagkans-bonus; de auto
--     slijt (-8 condition) per heist (repareerbaar in de garage).
--
-- Server-authoritative: bonussen/kosten uit catalogus, ownership gecheckt.
-- =====================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS weapons jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- koop wapen ----------
CREATE OR REPLACE FUNCTION public.buy_weapon(weapon_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cost int; label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  CASE weapon_id
    WHEN 'pistol' THEN cost := 2500;  label := 'Pistol';
    WHEN 'smg'    THEN cost := 12000; label := 'SMG';
    WHEN 'rifle'  THEN cost := 35000; label := 'Rifle';
    ELSE RAISE EXCEPTION 'UNKNOWN_WEAPON';
  END CASE;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.weapons ? weapon_id THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
     SET cash = cash - cost,
         weapons = COALESCE(weapons, '[]'::jsonb) || jsonb_build_array(weapon_id)
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'weapon', weapon_id, 'label', label, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_weapon(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_weapon(text) TO authenticated;

-- ---------- weapon-bonus helper ----------
CREATE OR REPLACE FUNCTION public._weapon_bonus(weapon_id text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE weapon_id WHEN 'pistol' THEN 4 WHEN 'smg' THEN 9 WHEN 'rifle' THEN 16 ELSE 0 END; $$;

-- ---------- commit_heist met verplicht wapen + getaway-auto ----------
DROP FUNCTION IF EXISTS public.commit_heist(text, integer, integer);

CREATE OR REPLACE FUNCTION public.commit_heist(
  heist_key text, crew_size integer, bullets_used integer DEFAULT 0,
  weapon text DEFAULT NULL, car_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  -- getaway-auto slijt
  UPDATE public.player_cars SET condition = GREATEST(0, condition - 8) WHERE id = car.id;

  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players SET cash = p.cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, bullets = p.bullets WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_heist(text, integer, integer, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.commit_heist(text, integer, integer, text, uuid) TO authenticated;
