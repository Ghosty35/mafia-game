-- 096_property_laundering_hardening.sql
-- =====================================================================
-- Hardening for 095_property_laundering.sql
-- ---------------------------------------------------------------------
-- 1) launder_via_property: also block while DEAD (was only IN_JAIL), for
--    consistency with the other criminal RPCs.
-- 2) sell_property: refuse to sell a property that still has an active
--    laundering batch (launder_pending > 0). Otherwise the pumped
--    dirty cash would be silently destroyed with the property.
-- =====================================================================

-- ---------- 1) death check on start ----------
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
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF COALESCE(p.dirty_cash, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_DIRTY_CASH'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF NOT found AND el->>'id' = p_prop_id THEN
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

-- ---------- 2) block selling a property mid-wash ----------
CREATE OR REPLACE FUNCTION public.sell_property(p_prop_id text)
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
  refund      bigint := 0;
  cat_price   bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = p_prop_id THEN
      -- refuse to sell if dirty cash is still washing here (would be lost)
      IF COALESCE((el->>'launder_pending')::bigint, 0) > 0 THEN
        RAISE EXCEPTION 'LAUNDER_ACTIVE';
      END IF;
      SELECT COALESCE(pc.price, (el->>'price')::bigint, 0) INTO cat_price
        FROM public.property_catalog pc
       WHERE pc.id = COALESCE(el->>'catalog_id', el->>'id');
      refund := floor(cat_price * 0.50)::bigint;
      found := true;
    ELSE
      new_props := new_props || jsonb_build_array(el);
    END IF;
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;
  IF refund <= 0 THEN RAISE EXCEPTION 'CANNOT_SELL'; END IF;

  UPDATE public.players
  SET cash = cash + refund, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'refund', refund);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_property(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sell_property(text) TO authenticated;
