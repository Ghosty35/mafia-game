-- 118_admin_moderation_and_real_estate_expansion.sql
-- Admin moderation: warn/ban/kick/timeout/ip_ban with 3-warn auto ban.
-- Real estate: add Penthouse and Yacht to every city.
-- Yacht unlocks Piggy Bank system.

-- ============================================================
-- 1) Moderation table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_moderation (
  player_id       uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  warnings        int NOT NULL DEFAULT 0,
  banned_until    timestamptz,
  banned_permanent boolean NOT NULL DEFAULT false,
  timeout_until   timestamptz,
  ip_banned       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_moderation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_moderation_admin ON public.player_moderation;
CREATE POLICY player_moderation_admin ON public.player_moderation
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username = 'YGhosty')
  );

-- ============================================================
-- 2) Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_banned(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT banned_permanent OR (banned_until IS NOT NULL AND banned_until > now())
     FROM public.player_moderation WHERE player_id = p_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_timed_out(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT timeout_until IS NOT NULL AND timeout_until > now()
     FROM public.player_moderation WHERE player_id = p_id),
    false
  );
$$;

-- ============================================================
-- 3) Admin moderation RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_warn_player(target_id uuid, reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_warnings int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.player_moderation (player_id, warnings)
  VALUES (target_id, 1)
  ON CONFLICT (player_id) DO UPDATE SET
    warnings = player_moderation.warnings + 1,
    updated_at = now()
  RETURNING warnings INTO new_warnings;

  IF new_warnings >= 3 THEN
    UPDATE public.player_moderation
    SET banned_permanent = true, updated_at = now()
    WHERE player_id = target_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'warnings', new_warnings, 'banned', new_warnings >= 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_kick_player(target_id uuid, duration_minutes int DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.player_moderation (player_id, timeout_until)
  VALUES (target_id, now() + make_interval(mins => duration_minutes))
  ON CONFLICT (player_id) DO UPDATE SET
    timeout_until = now() + make_interval(mins => duration_minutes),
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'timeout_until', now() + make_interval(mins => duration_minutes));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ban_player(target_id uuid, duration_hours int DEFAULT 24, permanent boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.player_moderation (player_id, banned_until, banned_permanent)
  VALUES (target_id,
          CASE WHEN permanent THEN NULL ELSE now() + make_interval(hours => duration_hours) END,
          permanent)
  ON CONFLICT (player_id) DO UPDATE SET
    banned_until = CASE WHEN permanent THEN NULL ELSE now() + make_interval(hours => duration_hours) END,
    banned_permanent = permanent,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'permanent', permanent);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unban_player(target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.player_moderation
  SET banned_until = NULL, banned_permanent = false, updated_at = now()
  WHERE player_id = target_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_timeout_player(target_id uuid, duration_minutes int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.player_moderation (player_id, timeout_until)
  VALUES (target_id, now() + make_interval(mins => duration_minutes))
  ON CONFLICT (player_id) DO UPDATE SET
    timeout_until = now() + make_interval(mins => duration_minutes),
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'timeout_until', now() + make_interval(mins => duration_minutes));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ip_ban_player(target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  INSERT INTO public.player_moderation (player_id, ip_banned)
  VALUES (target_id, true)
  ON CONFLICT (player_id) DO UPDATE SET
    ip_banned = true, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_warnings(target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.player_moderation
  SET warnings = 0, banned_until = NULL, banned_permanent = false, updated_at = now()
  WHERE player_id = target_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 4) Enforcement hooks in common self-service RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cash_delta < -10000000 OR cash_delta > 10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  IF cash_delta < 0 AND p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players SET
    cash                  = cash + cash_delta,
    owned_properties      = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    cars                  = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level          = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    drug_storage          = CASE WHEN patch ? 'drug_storage' THEN patch->'drug_storage' ELSE drug_storage END,
    weed_plants           = CASE WHEN patch ? 'weed_plants' THEN patch->'weed_plants' ELSE weed_plants END,
    weed_progress         = CASE WHEN patch ? 'weed_progress' THEN (patch->>'weed_progress')::int ELSE weed_progress END,
    successful_harvest_kg = CASE WHEN patch ? 'successful_harvest_kg' THEN (patch->>'successful_harvest_kg')::numeric ELSE successful_harvest_kg END,
    failed_harvest_kg     = CASE WHEN patch ? 'failed_harvest_kg' THEN (patch->>'failed_harvest_kg')::numeric ELSE failed_harvest_kg END,
    breakout_skill        = CASE WHEN patch ? 'breakout_skill' THEN (patch->>'breakout_skill')::numeric ELSE breakout_skill END,
    heat                  = CASE WHEN patch ? 'heat' THEN LEAST(100, GREATEST(0, (patch->>'heat')::int)) ELSE heat END,
    bullets               = CASE WHEN patch ? 'bullets' THEN GREATEST(0, (patch->>'bullets')::bigint) ELSE bullets END,
    heist_gear            = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;

CREATE OR REPLACE FUNCTION public.travel_to_city(city text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  cost bigint := 380;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;
  IF p.current_city = city THEN RAISE EXCEPTION 'ALREADY_THERE'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - cost, current_city = city
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'city', city, 'cost', cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_druglab(p_city text, p_drug_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  r jsonb := public._druglab_rates();
  cost bigint := (r->>'buy_cost')::bigint;
  tax bigint;
  lid uuid;
  owned int;
  city_owned int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT COUNT(*) INTO owned FROM public.player_druglabs WHERE player_id = p.id;
  IF owned >= 1 THEN RAISE EXCEPTION 'LAB_LIMIT'; END IF;

  SELECT COUNT(*) INTO city_owned FROM public.player_druglabs WHERE city = p_city AND drug_type = p_drug_type;
  IF city_owned >= 3 THEN RAISE EXCEPTION 'LAB_CITY_LIMIT'; END IF;

  tax := floor(cost * (r->>'buy_tax_rate')::numeric)::bigint;

  INSERT INTO public.player_druglabs (player_id, city, drug_type)
  VALUES (p.id, p_city, p_drug_type) RETURNING id INTO lid;

  UPDATE public.players
  SET cash = cash - cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'lab_id', lid, 'city', p_city, 'drug_type', p_drug_type, 'cost', cost, 'tax', tax);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_property(prop jsonb, price bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  tax bigint;
  total_cost bigint;
  owned_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  SELECT jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) INTO owned_count;
  IF owned_count >= 5 THEN
    RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
  END IF;

  tax := floor(price * 0.10)::bigint;
  total_cost := price + tax;

  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      owned_properties = COALESCE(owned_properties, '[]'::jsonb) || jsonb_build_array(prop)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tax', tax, 'total_cost', total_cost);
END;
$$;

-- ============================================================
-- 5) Real estate expansion: Penthouse + Yacht per city
-- ============================================================
INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots)
VALUES
  ('ph_ny', 'Penthouse', 'penthouse', 'residential', 'New York', 2500000, 450, 12),
  ('ph_chi', 'Penthouse', 'penthouse', 'residential', 'Chicago', 2400000, 430, 12),
  ('ph_la', 'Penthouse', 'penthouse', 'residential', 'Los Angeles', 2450000, 440, 12),
  ('ph_mi', 'Penthouse', 'penthouse', 'residential', 'Miami', 2350000, 420, 12),
  ('ph_lv', 'Penthouse', 'penthouse', 'residential', 'Las Vegas', 2600000, 460, 12),
  ('yacht_ny', 'Yacht', 'yacht', 'luxury', 'New York', 10000000, 200, 0),
  ('yacht_chi', 'Yacht', 'yacht', 'luxury', 'Chicago', 9500000, 190, 0),
  ('yacht_la', 'Yacht', 'yacht', 'luxury', 'Los Angeles', 9800000, 195, 0),
  ('yacht_mi', 'Yacht', 'yacht', 'luxury', 'Miami', 9200000, 185, 0),
  ('yacht_lv', 'Yacht', 'yacht', 'luxury', 'Las Vegas', 10500000, 210, 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6) Update admin_list_players to include moderation info
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_players(search text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', id, 'username', username, 'cash', cash, 'power', power,
    'level', level, 'rebirths', rebirths, 'murder_skill', murder_skill,
    'is_donator', is_donator, 'jailed_until', jailed_until,
    'death_until', death_until, 'heat', heat, 'personal_bank', personal_bank,
    'warnings', COALESCE(pm.warnings, 0),
    'banned_until', pm.banned_until,
    'banned_permanent', COALESCE(pm.banned_permanent, false),
    'timeout_until', pm.timeout_until,
    'ip_banned', COALESCE(pm.ip_banned, false)
  )
  FROM public.players p
  LEFT JOIN public.player_moderation pm ON pm.player_id = p.id
  WHERE search IS NULL OR username ILIKE '%' || search || '%'
  ORDER BY cash DESC
  LIMIT 50;
END;
$$;

-- ============================================================
-- 7) Grants
-- ============================================================
REVOKE ALL ON TABLE public.player_moderation FROM public, anon;
GRANT ALL ON TABLE public.player_moderation TO authenticated;

REVOKE ALL ON FUNCTION public.admin_warn_player(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_warn_player(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_kick_player(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_kick_player(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_ban_player(uuid, int, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban_player(uuid, int, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_unban_player(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_unban_player(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_timeout_player(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_timeout_player(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_ip_ban_player(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ip_ban_player(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_warnings(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_warnings(uuid) TO authenticated;
