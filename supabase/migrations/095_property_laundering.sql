-- 095_property_laundering.sql
-- =====================================================================
-- SPOOR E (deel 2) — launder dirty cash THROUGH owned properties
-- ---------------------------------------------------------------------
-- Players who own a property can now wash dirty_cash via that property
-- as an alternative to the laundromat/casino/offshore channels.
--
-- Model: FEE + TIME (server-authoritative, abuse-resistant)
--   * launder_via_property(prop_id, amount): pump dirty cash into a
--     property. It locks a per-batch fee and a ready_at timestamp. Only
--     ONE active batch per property. Cannot exceed the property's tier
--     capacity, and cannot pump more dirty_cash than you have.
--   * collect_property_launder(prop_id): after ready_at passes, collect
--     clean cash (amount - fee). The fee is routed into the government
--     tax fund (players.gov_tax_bank), consistent with the rest of the
--     economy. Bust risk (heat/350, halved by Corrupt Lawyer) is rolled
--     HERE — a bust confiscates the batch + adds heat.
--
-- Tiers (ptype):    fee    capacity     wash time
--   mansion         10%    25,000,000   6h
--   villa           13%    12,000,000   5h
--   house           16%     5,000,000   4h
--   agency (etc.)   18%     8,000,000   4h
--
-- The batch fields live INSIDE each owned_properties element
--   (launder_pending, launder_fee, launder_ready_at, launder_started_at)
-- so they survive the array-preserving rewrites in the income/bill RPCs.
-- =====================================================================

-- ---------- tier catalog helper ----------
CREATE OR REPLACE FUNCTION public._property_launder_tier(p_ptype text,
  OUT fee_pct numeric, OUT capacity bigint, OUT wash_seconds int)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  CASE lower(COALESCE(p_ptype, ''))
    WHEN 'mansion' THEN fee_pct := 0.10; capacity := 25000000; wash_seconds := 21600;
    WHEN 'villa'   THEN fee_pct := 0.13; capacity := 12000000; wash_seconds := 18000;
    WHEN 'house'   THEN fee_pct := 0.16; capacity :=  5000000; wash_seconds := 14400;
    ELSE                fee_pct := 0.18; capacity :=  8000000; wash_seconds := 14400;
  END CASE;
END;
$$;

-- ---------- start a laundering batch ----------
CREATE OR REPLACE FUNCTION public.launder_via_property(p_prop_id text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p          public.players;
  new_props  jsonb := '[]'::jsonb;
  el         jsonb;
  found      boolean := false;
  tier       record;
  fee        bigint;
  ready_at   timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount IS NULL OR p_amount < 100 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF COALESCE(p.dirty_cash, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_DIRTY_CASH'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF NOT found AND el->>'id' = p_prop_id THEN
      -- already an active batch on this property?
      IF COALESCE((el->>'launder_pending')::bigint, 0) > 0 THEN
        RAISE EXCEPTION 'BATCH_ACTIVE';
      END IF;

      SELECT * INTO tier FROM public._property_launder_tier(el->>'ptype');
      IF p_amount > tier.capacity THEN RAISE EXCEPTION 'OVER_CAPACITY'; END IF;

      fee      := floor(p_amount * tier.fee_pct)::bigint;
      ready_at := now() + make_interval(secs => tier.wash_seconds);

      el := jsonb_set(el, '{launder_pending}',    to_jsonb(p_amount));
      el := jsonb_set(el, '{launder_fee}',        to_jsonb(fee));
      el := jsonb_set(el, '{launder_started_at}', to_jsonb(now()));
      el := jsonb_set(el, '{launder_ready_at}',   to_jsonb(ready_at));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
     SET dirty_cash = dirty_cash - p_amount,
         owned_properties = new_props
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'pending', p_amount, 'fee', fee,
    'ready_at', ready_at, 'new_dirty', COALESCE(p.dirty_cash, 0) - p_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.launder_via_property(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.launder_via_property(text, bigint) TO authenticated;

-- ---------- collect a finished batch ----------
CREATE OR REPLACE FUNCTION public.collect_property_launder(p_prop_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p            public.players;
  new_props    jsonb := '[]'::jsonb;
  el           jsonb;
  found        boolean := false;
  pending      bigint := 0;
  fee          bigint := 0;
  ready_at     timestamptz;
  bust_chance  numeric;
  busted       boolean := false;
  cleaned      bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF NOT found AND el->>'id' = p_prop_id THEN
      pending  := COALESCE((el->>'launder_pending')::bigint, 0);
      fee      := COALESCE((el->>'launder_fee')::bigint, 0);
      ready_at := (el->>'launder_ready_at')::timestamptz;

      IF pending <= 0 THEN RAISE EXCEPTION 'NO_BATCH'; END IF;
      IF ready_at IS NULL OR ready_at > now() THEN RAISE EXCEPTION 'NOT_READY'; END IF;

      -- clear the batch fields regardless of outcome
      el := jsonb_set(el, '{launder_pending}',    to_jsonb(0));
      el := jsonb_set(el, '{launder_fee}',        to_jsonb(0));
      el := el - 'launder_ready_at' - 'launder_started_at';
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  -- bust risk scales with heat; Corrupt Lawyer halves it
  bust_chance := COALESCE(p.heat, 0) / 350.0;
  IF COALESCE(p.has_corrupt_lawyer, false) THEN bust_chance := bust_chance / 2; END IF;
  busted := random() < bust_chance;

  INSERT INTO public.launder_history (player_id, channel, amount, busted)
  VALUES (p.id, 'property', pending, busted);

  IF busted THEN
    UPDATE public.players
       SET owned_properties = new_props,
           heat = LEAST(100, COALESCE(heat, 0) + 20),
           heat_updated_at = now()
     WHERE id = p.id;
    PERFORM public._log_event_named(p.username, 'bust',
      'got busted laundering $' || pending || ' through a front — the feds seized it!');
    RETURN jsonb_build_object('success', false, 'busted', true, 'lost', pending,
      'new_heat', LEAST(100, COALESCE(p.heat, 0) + 20));
  END IF;

  cleaned := pending - fee;
  UPDATE public.players
     SET owned_properties = new_props,
         cash = cash + cleaned,
         gov_tax_bank = COALESCE(gov_tax_bank, 0) + fee
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'busted', false, 'washed', pending,
    'fee', fee, 'cleaned', cleaned, 'new_cash', COALESCE(p.cash, 0) + cleaned);
END;
$$;

REVOKE ALL ON FUNCTION public.collect_property_launder(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.collect_property_launder(text) TO authenticated;
