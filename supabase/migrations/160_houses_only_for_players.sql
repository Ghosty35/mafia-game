-- 160_houses_only_for_players.sql
-- Restrict direct property purchases to residential types for regular players:
--   house, villa, mansion, penthouse, yacht
-- Admin/ceo can still buy any property type directly, including agency types:
--   agency, airport, casino, tuneshop, redlight
-- Agency properties are intended to be owned by admin and auctioned via marketplace.

BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_property(p_catalog_id text, p_custom_name text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  cat        public.property_catalog;
  p          public.players;
  tax        bigint;
  total_cost bigint;
  newprop    jsonb;
  is_admin_player boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO cat FROM public.property_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_PROPERTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  is_admin_player := public.is_admin();

  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  -- Non-admin players can only buy residential properties directly.
  IF NOT is_admin_player AND cat.ptype NOT IN ('house','villa','mansion','penthouse','yacht') THEN
    RAISE EXCEPTION 'PROPERTY_TYPE_LOCKED';
  END IF;

  IF cat.city <> COALESCE(p.current_city, 'New York') THEN
    RAISE EXCEPTION 'WRONG_CITY';
  END IF;

  IF NOT is_admin_player THEN
    IF jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) >= 4 THEN
      RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) e
      WHERE e->>'catalog_id' = cat.id OR e->>'id' = cat.id
    ) THEN
      RAISE EXCEPTION 'ALREADY_OWNED';
    END IF;

    IF cat.ptype = 'mansion' AND public._count_owned_ptype(p.owned_properties, 'mansion') >= 2 THEN
      RAISE EXCEPTION 'MAX_MANSION';
    END IF;
    IF cat.ptype = 'villa' AND public._count_owned_ptype(p.owned_properties, 'villa') >= 3 THEN
      RAISE EXCEPTION 'MAX_VILLAS';
    END IF;
    IF cat.ptype = 'house' AND public._count_owned_ptype(p.owned_properties, 'house') >= 4 THEN
      RAISE EXCEPTION 'MAX_HOUSES';
    END IF;
    IF cat.ptype = 'penthouse' AND public._count_owned_ptype(p.owned_properties, 'penthouse') >= 1 THEN
      RAISE EXCEPTION 'MAX_PENTHOUSES';
    END IF;
    IF cat.ptype = 'yacht' AND public._count_owned_ptype(p.owned_properties, 'yacht') >= 1 THEN
      RAISE EXCEPTION 'MAX_YACHTS';
    END IF;
  END IF;

  tax        := floor(cat.price * (public._cfg('property_tax_pct', 10) / 100.0))::bigint;
  total_cost := cat.price + tax;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  newprop := jsonb_build_object(
    'id',              cat.id,
    'catalog_id',      cat.id,
    'name',            COALESCE(NULLIF(btrim(p_custom_name), ''), cat.name),
    'ptype',           cat.ptype,
    'type',            cat.type,
    'city',            cat.city,
    'income',          cat.income,
    'spots',           cat.spots,
    'purchase_date',   now(),
    'bank_balance',    0,
    'maintenance_due', floor(cat.income * 0.12)::bigint,
    'autopay',         false,
    'shed_level',      1,
    'earnings_week',   0,
    'last_earned',     now()
  );

  UPDATE public.players
  SET cash             = cash - total_cost,
      gov_tax_bank     = COALESCE(gov_tax_bank, 0) + tax,
      owned_properties = COALESCE(owned_properties, '[]'::jsonb) || jsonb_build_array(newprop)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'price', cat.price, 'tax', tax, 'total_cost', total_cost, 'property', newprop);
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_property(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.purchase_property(text, text) TO authenticated;

COMMIT;
