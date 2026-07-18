-- 120_yacht_perks_and_admin_stats.sql
-- Yacht: premium owner perks applied server-side.
-- Admin: expanded stats and leaderboards.

-- ============================================================
-- 1) Yacht perks helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_yacht(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(owned_properties, '[]'::jsonb)) el
      WHERE el->>'ptype' = 'yacht'
    ) FROM public.players WHERE id = p_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.yacht_income_multiplier()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT 1.05;
$$;

CREATE OR REPLACE FUNCTION public.yacht_tax_discount()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT 0.10;
$$;

CREATE OR REPLACE FUNCTION public.yacht_cooldown_discount()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT 0.05;
$$;

-- ============================================================
-- 2) Apply yacht perks in property income RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.collect_property_income(prop_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  prop_jsonb jsonb;
  income bigint;
  final_income bigint;
  now_ts timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  SELECT jsonb_agg(el) INTO prop_jsonb
  FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) el
  WHERE el->>'id' = prop_id;

  IF prop_jsonb IS NULL OR jsonb_array_length(prop_jsonb) = 0 THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND';
  END IF;

  income := COALESCE((prop_jsonb->0->>'income')::bigint, 0);
  final_income := floor(income * public.yacht_income_multiplier())::bigint;

  UPDATE public.players
  SET cash = cash + final_income,
      owned_properties = jsonb_set(
        owned_properties,
        ARRAY[
          (SELECT idx::text FROM jsonb_array_elements(owned_properties) WITH ORDINALITY AS arr(el, idx) WHERE el->>'id' = prop_id LIMIT 1),
          'last_earned'
        ],
        to_jsonb(now_ts)
      )
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'base_income', income, 'final_income', final_income, 'yacht_bonus', public.has_yacht(p.id));
END;
$$;

-- ============================================================
-- 3) Apply yacht tax discount in purchase_property
-- ============================================================
CREATE OR REPLACE FUNCTION public.purchase_property(prop jsonb, price bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  tax bigint;
  total_cost bigint;
  owned_count int;
  new_ptype text;
  existing_ptype text;
  yacht_discount numeric := 0.0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  new_ptype := prop->>'ptype';
  IF new_ptype IS NULL THEN RAISE EXCEPTION 'INVALID_PROPERTY_TYPE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  IF public.has_yacht(p.id) THEN
    yacht_discount := public.yacht_tax_discount();
  END IF;

  SELECT jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) INTO owned_count;
  IF owned_count >= 5 THEN
    RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
  END IF;

  FOR existing_ptype IN
    SELECT el->>'ptype' FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) el
  LOOP
    IF existing_ptype = new_ptype THEN
      RAISE EXCEPTION 'ALREADY_OWN_THIS_TYPE';
    END IF;
  END LOOP;

  tax := floor(price * (0.10 - yacht_discount))::bigint;
  total_cost := price + tax;

  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      owned_properties = COALESCE(owned_properties, '[]'::jsonb) || jsonb_build_array(prop)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tax', tax, 'total_cost', total_cost, 'yacht_discount', yacht_discount > 0);
END;
$$;

-- ============================================================
-- 4) Admin stats leaderboards
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_top_cash(limit_count int DEFAULT 10)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'rank', ROW_NUMBER() OVER (ORDER BY p.cash DESC),
    'id', p.id, 'username', p.username, 'cash', p.cash,
    'level', p.level, 'power', p.power, 'rebirths', p.rebirths
  )
  FROM public.players p
  ORDER BY p.cash DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_top_diamonds(limit_count int DEFAULT 10)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'rank', ROW_NUMBER() OVER (ORDER BY p.diamonds DESC),
    'id', p.id, 'username', p.username, 'diamonds', p.diamonds,
    'level', p.level, 'is_donator', p.is_donator
  )
  FROM public.players p
  ORDER BY p.diamonds DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_top_level(limit_count int DEFAULT 10)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'rank', ROW_NUMBER() OVER (ORDER BY p.level DESC, p.xp DESC),
    'id', p.id, 'username', p.username, 'level', p.level, 'xp', p.xp,
    'power', p.power, 'rebirths', p.rebirths
  )
  FROM public.players p
  ORDER BY p.level DESC, p.xp DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_top_active(limit_count int DEFAULT 10)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'rank', ROW_NUMBER() OVER (ORDER BY p.last_active DESC NULLS LAST),
    'id', p.id, 'username', p.username, 'last_active', p.last_active,
    'level', p.level, 'power', p.power
  )
  FROM public.players p
  WHERE p.last_active IS NOT NULL
  ORDER BY p.last_active DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_server_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT jsonb_build_object(
    'total_players', COUNT(*),
    'total_cash', COALESCE(SUM(cash), 0),
    'total_bank', COALESCE(SUM(personal_bank), 0),
    'total_diamonds', COALESCE(SUM(diamonds), 0),
    'total_properties', COALESCE(SUM(jsonb_array_length(COALESCE(owned_properties, '[]'::jsonb))), 0),
    'total_families', (SELECT COUNT(*) FROM public.families),
    'avg_level', ROUND(AVG(level)::numeric, 1),
    'avg_power', ROUND(AVG(power)::numeric, 0),
    'active_last_hour', (SELECT COUNT(*) FROM public.players WHERE last_active > now() - interval '1 hour'),
    'active_last_day', (SELECT COUNT(*) FROM public.players WHERE last_active > now() - interval '1 day'),
    'banned_count', (SELECT COUNT(*) FROM public.player_moderation WHERE banned_permanent OR (banned_until IS NOT NULL AND banned_until > now())),
    'timed_out_count', (SELECT COUNT(*) FROM public.player_moderation WHERE timeout_until IS NOT NULL AND timeout_until > now())
  ) INTO result
  FROM public.players;

  RETURN result;
END;
$$;

-- ============================================================
-- 5) Yacht cooldown discount hook
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  cooldown_discount numeric := 0.0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cash_delta < -10000000 OR cash_delta > 10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  IF public.has_yacht(p.id) THEN
    cooldown_discount := public.yacht_cooldown_discount();
  END IF;

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

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta, 'yacht_cooldown_discount', cooldown_discount);
END;
$$;

-- ============================================================
-- 6) Grants
-- ============================================================
REVOKE ALL ON FUNCTION public.has_yacht(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_yacht(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.yacht_income_multiplier() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.yacht_income_multiplier() TO authenticated;
REVOKE ALL ON FUNCTION public.yacht_tax_discount() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.yacht_tax_discount() TO authenticated;
REVOKE ALL ON FUNCTION public.yacht_cooldown_discount() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.yacht_cooldown_discount() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_top_cash(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_top_cash(int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_top_diamonds(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_top_diamonds(int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_top_level(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_top_level(int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_top_active(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_top_active(int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_server_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_server_stats() TO authenticated;
