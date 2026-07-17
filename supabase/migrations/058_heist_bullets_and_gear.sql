-- 058_heist_bullets_and_gear.sql
-- =====================================================================
-- SPOOR D (heists) — bullets server-side consumeren + echte gear-koop
-- ---------------------------------------------------------------------
-- Voorheen:
--   * commit_heist negeerde bullets volledig (de slider was cosmetisch;
--     de client decrementte bullets alleen lokaal via updatePlayer=setPlayer,
--     dus heists kostten in de praktijk geen munitie).
--   * heist_gear werd door commit_heist gelezen voor de slaagkans, maar er
--     was geen legitieme manier om het te zetten (buyGear was lokaal-only,
--     en 057 haalde het uit update_my_state) -> gear-bonus deed niets.
--
-- Nu:
--   * commit_heist(heist_key, crew_size, bullets_used) valideert + verbruikt
--     bullets server-side (0..500, moet ze bezitten, verbruikt bij succes en
--     mislukking) en telt ze mee in de slaagkans: bonus = min(15, used/10) pp.
--   * buy_heist_gear(tier) koopt persistente gear uit een server-catalogus
--     en zet heist_gear = {bonus, tier}. commit_heist leest dit al.
--
-- Weapon-selector blijft voorlopig cosmetisch (gratis bonus zou een exploit
-- zijn; echte wapen-items zijn latere scope).
-- =====================================================================

-- ---------- commit_heist met server-side bullets ----------
-- Oude 2-arg signatuur droppen, anders blijft de bullet-loze variant als
-- overload callable (en kan men bullets-verbruik omzeilen).
DROP FUNCTION IF EXISTS public.commit_heist(text, integer);

CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size integer, bullets_used integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  p public.players;
  h record;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  base_success numeric;
  gear_bonus numeric := 0;
  crew_bonus numeric;
  bullet_bonus numeric := 0;
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

  SELECT * INTO h FROM public.heists WHERE key = heist_key;
  IF h.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_HEIST'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF p.level < h.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;

  final_crew := LEAST(GREATEST(crew_size, 2), 3);

  -- ---- bullets: server-side valideren + verbruiken ----
  bullets_spent := GREATEST(0, LEAST(COALESCE(bullets_used, 0), 500));
  IF COALESCE(p.bullets, 0) < bullets_spent THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
  bullet_bonus := LEAST(15, bullets_spent / 10.0);   -- percentagepunten, cap +15

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
  total_success := LEAST(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100) + (bullet_bonus / 100) - (p.heat / 250.0));

  succeeded := random() < total_success;

  -- munitie wordt sowieso verbruikt (succes of mislukking)
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

  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players SET cash = p.cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, bullets = p.bullets WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

-- ---------- buy_heist_gear: persistente gear uit server-catalogus ----------
CREATE OR REPLACE FUNCTION public.buy_heist_gear(tier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  cost int;
  bonus int;
  label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- server-catalogus (bron: heists armory-knoppen)
  CASE tier
    WHEN 'pistol'  THEN cost := 450;  bonus := 8;  label := 'Street Pistol';
    WHEN 'kevlar'  THEN cost := 720;  bonus := 12; label := 'Kevlar + Tools';
    WHEN 'fullkit' THEN cost := 1100; bonus := 18; label := 'Full Kit';
    ELSE RAISE EXCEPTION 'UNKNOWN_GEAR';
  END CASE;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
     SET cash = cash - cost,
         heist_gear = jsonb_build_object('tier', tier, 'label', label, 'bonus', bonus)
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tier', tier, 'bonus', bonus, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_heist_gear(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_heist_gear(text) TO authenticated;
