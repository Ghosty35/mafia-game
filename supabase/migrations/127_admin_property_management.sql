-- 127_admin_property_management.sql
-- Admin RPCs to manage any player's properties: give, sell, and inspect.

-- ============================================================
-- 1) admin_give_property: add a property to any player's inventory
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_give_property(
  p_target_username text,
  p_property jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_property IS NULL OR p_property = '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PROPERTY'; END IF;

  SELECT * INTO p FROM public.players WHERE username = p_target_username;
  IF p.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = p_property->>'id' THEN
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN
    new_props := new_props || p_property;
  END IF;

  UPDATE public.players SET owned_properties = new_props WHERE id = p.id;

  PERFORM public._log_event_named('Admin', 'property', 'gave ' || p_property->>'name' || ' to ' || p_target_username);

  RETURN jsonb_build_object('success', true, 'username', p.username, 'property', p_property);
END;
$$;

-- ============================================================
-- 2) admin_sell_property: remove a property from any player
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_sell_property(
  p_target_username text,
  p_prop_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  removed_name text := '';
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_prop_id IS NULL OR p_prop_id = '' THEN RAISE EXCEPTION 'INVALID_PROPERTY_ID'; END IF;

  SELECT * INTO p FROM public.players WHERE username = p_target_username;
  IF p.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = p_prop_id THEN
      removed_name := COALESCE(el->>'name', p_prop_id);
    ELSE
      new_props := new_props || jsonb_build_array(el);
    END IF;
  END LOOP;

  UPDATE public.players SET owned_properties = new_props WHERE id = p.id;

  PERFORM public._log_event_named('Admin', 'property', 'removed ' || removed_name || ' from ' || p_target_username);

  RETURN jsonb_build_object('success', true, 'username', p.username, 'removed_property_id', p_prop_id, 'removed_name', removed_name);
END;
$$;

-- ============================================================
-- 3) admin_list_player_properties: inspect a player's properties
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_player_properties(p_target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO p FROM public.players WHERE username = p_target_username;
  IF p.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;

  RETURN jsonb_build_object(
    'username', p.username,
    'properties', COALESCE(p.owned_properties, '[]'::jsonb),
    'property_count', COALESCE(jsonb_array_length(p.owned_properties), 0)
  );
END;
$$;

-- ============================================================
-- Grants
-- ============================================================
REVOKE ALL ON FUNCTION public.admin_give_property(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_give_property(text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_sell_property(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_sell_property(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_player_properties(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_player_properties(text) TO authenticated;
