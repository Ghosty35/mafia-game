-- 134_drop_forgeable_purchase_property.sql
-- Close the property-income forgery exploit. The legacy purchase_property(jsonb,bigint)
-- trusted a client-supplied prop JSON (income/spots/price) — a player could buy a
-- 99,999,999/hr property for $1. The catalog overload reads everything server-side
-- from property_catalog. Migrate to it and drop the legacy one. Also make property
-- tax live-tunable via game_config.

INSERT INTO public.game_config (key, num, label) VALUES
  ('property_tax_pct', 10, 'Property purchase tax %')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.purchase_property(p_catalog_id text, p_custom_name text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  cat        public.property_catalog;
  p          public.players;
  tax        bigint;
  total_cost bigint;
  newprop    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO cat FROM public.property_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_PROPERTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

  IF cat.city <> COALESCE(p.current_city, 'New York') THEN
    RAISE EXCEPTION 'WRONG_CITY';
  END IF;

  IF jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) >= 4 THEN
    RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) e
    WHERE e->>'catalog_id' = cat.id OR e->>'id' = cat.id
  ) THEN
    RAISE EXCEPTION 'ALREADY_OWNED';
  END IF;

  IF cat.ptype = 'mansion' AND public._count_owned_ptype(p.owned_properties, 'mansion') >= 1 THEN
    RAISE EXCEPTION 'MAX_MANSION';
  END IF;
  IF cat.ptype = 'villa' AND public._count_owned_ptype(p.owned_properties, 'villa') >= 2 THEN
    RAISE EXCEPTION 'MAX_VILLAS';
  END IF;
  IF cat.ptype = 'house' AND public._count_owned_ptype(p.owned_properties, 'house') >= 4 THEN
    RAISE EXCEPTION 'MAX_HOUSES';
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

-- Remove the forgeable overload.
DROP FUNCTION IF EXISTS public.purchase_property(jsonb, bigint);
