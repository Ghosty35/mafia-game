-- 052_drop_garage_fields_from_patch_rpcs.sql
-- =====================================================================
-- SPOOR A4 (deel 3c, sluitstuk) — cars/garage_level/bullets uit patch-RPC's
-- ---------------------------------------------------------------------
-- De garage-pagina is herschreven naar dedicated RPC's (050/051): auto's
-- leven nu in player_cars, mutaties gaan via garage_* RPC's, garage_level
-- via garage_upgrade_warehouse, bullets via garage_crush_car / buy_bullets.
--
-- Daarmee schrijft GEEN enkele pagina deze velden nog via apply_action /
-- update_my_state (geverifieerd: garage herschreven, race leest alleen,
-- heists' bullets-decrement is lokaal-only via updatePlayer=setPlayer,
-- safehouse raakt alleen owned_properties/avatar/bio). We verwijderen ze
-- daarom uit beide generieke patch-RPC's zodat ze niet meer forgeable zijn.
--
-- Resterend client-authoritative in deze RPC's (latere A4/A5-stappen):
--   apply_action     : owned_properties, heat, heist_gear
--   update_my_state  : owned_properties (piggy-injectie), heist_gear
-- =====================================================================

CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cash_delta < -10000000 OR cash_delta > 10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF cash_delta < 0 AND p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players SET
    cash             = cash + cash_delta,
    owned_properties = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    heat             = CASE WHEN patch ? 'heat' THEN LEAST(100, GREATEST(0, (patch->>'heat')::int)) ELSE heat END,
    heist_gear       = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): cars, garage_level, bullets (050/051),
    --   breakout_skill (049), drug/weed-economie (048)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_state(patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.players SET
    owned_properties = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    avatar_url       = CASE WHEN patch ? 'avatar_url' THEN patch->>'avatar_url' ELSE avatar_url END,
    bio              = CASE WHEN patch ? 'bio' THEN patch->>'bio' ELSE bio END,
    autopay_bills    = CASE WHEN patch ? 'autopay_bills' THEN (patch->>'autopay_bills')::boolean ELSE autopay_bills END,
    transaction_log  = CASE WHEN patch ? 'transaction_log' THEN patch->'transaction_log' ELSE transaction_log END,
    bill_history     = CASE WHEN patch ? 'bill_history' THEN patch->'bill_history' ELSE bill_history END,
    heist_gear       = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): cars, garage_level (050/051),
    --   drug/weed-economie (048)
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;
