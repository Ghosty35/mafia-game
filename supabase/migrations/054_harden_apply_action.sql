-- 054_harden_apply_action.sql
-- =====================================================================
-- SECURITY — apply_action volledig dichtgezet (geen callers meer)
-- ---------------------------------------------------------------------
-- Na 048-052 roept GEEN enkele pagina of DB-functie apply_action nog aan
-- (geverifieerd: app-code 0 hits, geen interne functie-calls). PostgREST
-- exposeert de RPC echter nog aan elke ingelogde user, dus direct aanroepen
-- blijft mogelijk:
--   apply_action(10000000, '{"owned_properties":[...],"heat":0}')
--   -> gratis geld (tot 10M/call) + owned_properties/heat/heist_gear forgen.
--
-- Fix: client-toegekende INKOMSTEN verbieden (cash_delta > 0 -> exception)
-- en alle patch-velden verwijderen. apply_action wordt zo een kale
-- "verbrand eigen cash"-RPC (negatief) die niets meer kan forgen. Inkomsten
-- lopen sowieso via dedicated RPC's (garage_sell_car, run_race, harvest, ...).
--
-- owned_properties/heist_gear blijven forgeable via update_my_state (safehouse)
-- -> aparte stap (property-catalog / dedicated RPC's).
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

  -- Client mag NOOIT inkomsten toekennen; alleen eigen cash verbranden.
  IF cash_delta > 0 THEN
    RAISE EXCEPTION 'CASH_DELTA_MUST_BE_NEGATIVE';
  END IF;
  IF cash_delta < -10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  -- Geen patch-velden meer: alles is server-owned via dedicated RPC's.
  UPDATE public.players SET cash = cash + cash_delta WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;
