-- 056_remove_owned_properties_patch_and_wire_income.sql
-- =====================================================================
-- SPOOR A5 (deel 2) — owned_properties injection dicht + income werkend
-- ---------------------------------------------------------------------
-- 1) update_my_state liet de client owned_properties WILLEKEURIG overschrijven
--    (safehouse simulateEarnings schreef de hele array terug = injectie +
--    client-authoritative idle-income geldkraan). We verwijderen het veld
--    uit update_my_state. Enige schrijver was safehouse.simulateEarnings,
--    dat nu naar collect_property_income() gaat.
--
-- 2) De echte server-side income (036 tick_property_income) werd NOOIT
--    aangeroepen -> income deed niets; de client-faucet was de enige bron.
--    We maken collect_property_income() self-accruing: het rekent zelf de
--    verdienste sinds last_earned (income * uren, cap 24u) en int die uit.
--    income komt nu uit de catalogus (055) -> niet meer te forgen.
-- =====================================================================

-- ---------- update_my_state zonder owned_properties ----------
CREATE OR REPLACE FUNCTION public.update_my_state(patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.players SET
    avatar_url      = CASE WHEN patch ? 'avatar_url' THEN patch->>'avatar_url' ELSE avatar_url END,
    bio             = CASE WHEN patch ? 'bio' THEN patch->>'bio' ELSE bio END,
    autopay_bills   = CASE WHEN patch ? 'autopay_bills' THEN (patch->>'autopay_bills')::boolean ELSE autopay_bills END,
    transaction_log = CASE WHEN patch ? 'transaction_log' THEN patch->'transaction_log' ELSE transaction_log END,
    bill_history    = CASE WHEN patch ? 'bill_history' THEN patch->'bill_history' ELSE bill_history END,
    heist_gear      = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): owned_properties (055/056 purchase_property,
    --   collect_property_income), cars/garage_level (050-052), drug/weed (048)
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- collect_property_income: self-accruing, server-authoritative ----------
CREATE OR REPLACE FUNCTION public.collect_property_income(prop_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p           public.players;
  new_props   jsonb := '[]'::jsonb;
  el          jsonb;
  found       boolean := false;
  amount      bigint := 0;
  income      bigint;
  cat_income  bigint;
  last_earned timestamptz;
  hours       numeric;
  earned      bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      -- Income AUTHORITATIEF uit de catalogus (val terug op opgeslagen waarde,
      -- gebound, voor legacy records zonder catalog-match). Zo kan een geforgede
      -- of ontbrekende income het uitbetaalde bedrag niet opblazen.
      SELECT pc.income INTO cat_income FROM public.property_catalog pc
        WHERE pc.id = COALESCE(el->>'catalog_id', el->>'id');
      income      := COALESCE(cat_income, LEAST(COALESCE((el->>'income')::bigint, 0), 500));
      last_earned := COALESCE((el->>'last_earned')::timestamptz, now());
      hours       := LEAST(24, GREATEST(0, EXTRACT(EPOCH FROM (now() - last_earned)) / 3600.0));
      earned      := floor(income * hours)::bigint;

      amount := COALESCE((el->>'bank_balance')::bigint, 0) + earned;
      IF amount <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_COLLECT'; END IF;

      el := jsonb_set(el, '{bank_balance}',  to_jsonb(0));
      el := jsonb_set(el, '{last_earned}',   to_jsonb(now()));
      el := jsonb_set(el, '{earnings_week}', to_jsonb(COALESCE((el->>'earnings_week')::bigint, 0) + earned));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash + amount, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'collected', amount);
END;
$$;
