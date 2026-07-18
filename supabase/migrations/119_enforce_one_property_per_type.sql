-- 119_enforce_one_property_per_type.sql
-- Players can own max 1 of each property type:
-- house, villa, mansion, penthouse, yacht

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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  new_ptype := prop->>'ptype';
  IF new_ptype IS NULL THEN RAISE EXCEPTION 'INVALID_PROPERTY_TYPE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;

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

  tax := floor(price * 0.10)::bigint;
  total_cost := price + tax;

  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      owned_properties = COALESCE(owned_properties, '[]'::jsonb) || jsonb_build_array(prop)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tax', tax, 'total_cost', total_cost);
END;
$$;
