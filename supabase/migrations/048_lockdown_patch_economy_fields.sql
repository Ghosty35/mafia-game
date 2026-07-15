-- 048_lockdown_patch_economy_fields.sql
-- =====================================================================
-- SPOOR A4 (deel 1) — client-authoritative economie-velden dichtzetten
-- ---------------------------------------------------------------------
-- apply_action() en update_my_state() lieten de client WILLEKEURIGE
-- waarden schrijven voor de drug-/wiet-economie:
--   drug_storage, weed_plants, weed_progress,
--   successful_harvest_kg, failed_harvest_kg
--
-- Exploit: client zet drug_storage op fantasie-voorraad en verkoopt die
-- via sell_drug (045) voor echt geld -> de server-authoritative drugmarkt
-- wordt volledig omzeild. Idem voor harvest-kg (leaderboard/uitbetaling).
--
-- Deze velden zijn nu eigendom van dedicated RPC's:
--   buy_drug / sell_drug        (045)  -> drug_storage
--   water_weed_plant / harvest_weed (046) -> weed_plants/progress/harvest_kg
--
-- Geen enkele frontend-pagina schrijft deze velden nog via apply_action /
-- update_my_state (geverifieerd: street-dealer, weed-grow, garage, jail,
-- safehouse). Signaturen blijven gelijk -> non-breaking, geen client-edits.
--
-- NOG NIET hier opgelost (rest van A4, vereist dedicated RPC's + page-edits):
--   * cars / garage_level / bullets  (garage)  -> client bepaalt kosten
--   * breakout_skill                 (jail)    -> goedkope client-training
--   * owned_properties               (safehouse)-> piggy-injectie
--   * heat / heist_gear
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
    cars             = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level     = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    breakout_skill   = CASE WHEN patch ? 'breakout_skill' THEN (patch->>'breakout_skill')::numeric ELSE breakout_skill END,
    heat             = CASE WHEN patch ? 'heat' THEN LEAST(100, GREATEST(0, (patch->>'heat')::int)) ELSE heat END,
    bullets          = CASE WHEN patch ? 'bullets' THEN GREATEST(0, (patch->>'bullets')::bigint) ELSE bullets END,
    heist_gear       = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): drug_storage, weed_plants, weed_progress,
    --                            successful_harvest_kg, failed_harvest_kg
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
    cars             = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level     = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    avatar_url       = CASE WHEN patch ? 'avatar_url' THEN patch->>'avatar_url' ELSE avatar_url END,
    bio              = CASE WHEN patch ? 'bio' THEN patch->>'bio' ELSE bio END,
    autopay_bills    = CASE WHEN patch ? 'autopay_bills' THEN (patch->>'autopay_bills')::boolean ELSE autopay_bills END,
    transaction_log  = CASE WHEN patch ? 'transaction_log' THEN patch->'transaction_log' ELSE transaction_log END,
    bill_history     = CASE WHEN patch ? 'bill_history' THEN patch->'bill_history' ELSE bill_history END,
    heist_gear       = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): drug_storage, weed_plants, weed_progress,
    --                            successful_harvest_kg, failed_harvest_kg
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;
