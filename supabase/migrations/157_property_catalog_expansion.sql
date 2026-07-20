-- 157_property_catalog_expansion.sql
-- Expand property_catalog so each city has:
--   4x houses, 3x villas, 2x mansions, 1x penthouse, 1x yacht
-- Update purchase_property to enforce new per-type limits and allow admin bypass.

BEGIN;

-- ---- Expand residential catalog with unique names per city ----
INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots) VALUES
  -- New York residential
  ('house_ny_2', 'Brooklyn Loft',       'house',     'residential', 'New York',     22000,  55, 2),
  ('house_ny_3', 'Queens Townhouse',    'house',     'residential', 'New York',     26000,  65, 2),
  ('house_ny_4', 'Bronx Starter',       'house',     'residential', 'New York',     20000,  50, 2),
  ('house_ny_5', 'Staten Home',         'house',     'residential', 'New York',     18000,  45, 2),
  ('villa_ny_2', 'Hamptons Villa',      'villa',     'residential', 'New York',    110000,  180, 4),
  ('villa_ny_3', 'Hamptons Estate',     'villa',     'residential', 'New York',    130000,  200, 4),
  ('villa_ny_4', 'Long Island Manor',   'villa',     'residential', 'New York',     95000,  160, 4),
  ('mansion_ny_2','Central Park Palace','mansion',   'residential', 'New York',   2200000,  450, 8),
  ('mansion_ny_3','Fifth Avenue Tower', 'mansion',   'residential', 'New York',   2800000,  550, 8),
  ('penth_ny',   'Manhattan Penthouse', 'penthouse', 'residential', 'New York',   1200000,  320, 6),
  ('yacht_ny',   'NYC Mega Yacht',      'yacht',     'residential', 'New York',   3500000,  600, 10),

  -- Chicago residential
  ('house_chi_2','Lincoln Park Bungalow','house',   'residential', 'Chicago',      21000,  52, 2),
  ('house_chi_3','River North Condo',   'house',     'residential', 'Chicago',      25000,  62, 2),
  ('house_chi_4','Wicker Park Duplex',  'house',     'residential', 'Chicago',      19000,  48, 2),
  ('house_chi_5','South Side Home',     'house',     'residential', 'Chicago',      17000,  44, 2),
  ('villa_chi_2','Gold Coast Villa',    'villa',     'residential', 'Chicago',     105000,  170, 4),
  ('villa_chi_3','Lake Shore Estate',   'villa',     'residential', 'Chicago',     125000,  190, 4),
  ('villa_chi_4','Lincoln Park Estate', 'villa',     'residential', 'Chicago',      90000,  150, 4),
  ('mansion_chi_2','Gold Coast Palace', 'mansion',   'residential', 'Chicago',    1950000,  400, 8),
  ('mansion_chi_3','Lakefront Tower',   'mansion',   'residential', 'Chicago',   2400000,  480, 8),
  ('penth_chi',  'Chicago Sky Penthouse','penthouse','residential', 'Chicago',    1000000,  270, 6),
  ('yacht_chi',  'Chicago Lake Yacht',  'yacht',     'residential', 'Chicago',   2600000,  500, 10),

  -- Los Angeles residential
  ('house_la_2', 'Silver Lake Bungalow','house',     'residential', 'Los Angeles',  23000,  58, 2),
  ('house_la_3', 'Venice Beach House',  'house',     'residential', 'Los Angeles',  27000,  68, 2),
  ('house_la_4', 'Hollywood Hills Home','house',     'residential', 'Los Angeles',  31000,  78, 2),
  ('house_la_5', 'Burbank Starter',     'house',     'residential', 'Los Angeles',  20000,  52, 2),
  ('villa_la_2', 'Beverly Hills Villa', 'villa',     'residential', 'Los Angeles', 125000,  190, 4),
  ('villa_la_3', 'Bel Air Estate',      'villa',     'residential', 'Los Angeles', 145000,  210, 4),
  ('villa_la_4', 'Malibu Colony Villa', 'villa',     'residential', 'Los Angeles', 100000,  165, 4),
  ('mansion_la_2','Bel Air Mansion',    'mansion',   'residential', 'Los Angeles', 2100000,  430, 8),
  ('mansion_la_3','Hollywood Hills Estate','mansion','residential', 'Los Angeles',2600000,  520, 8),
  ('penth_la',   'Beverly Penthouse',   'penthouse', 'residential', 'Los Angeles', 1300000,  340, 6),
  ('yacht_la',   'Pacific Mega Yacht',  'yacht',     'residential', 'Los Angeles', 3200000,  580, 10),

  -- Miami residential
  ('house_mi_2', 'Coconut Grove Bungalow','house',  'residential', 'Miami',        22500,  56, 2),
  ('house_mi_3', 'South Beach Condo',   'house',     'residential', 'Miami',        26500,  66, 2),
  ('house_mi_4', 'Design District Home','house',     'residential', 'Miami',        30500,  76, 2),
  ('house_mi_5', 'Key Biscayne Cottage','house',     'residential', 'Miami',        19000,  48, 2),
  ('villa_mi_2', 'Star Island Villa',   'villa',     'residential', 'Miami',       112000,  175, 4),
  ('villa_mi_3', 'Fisher Island Estate','villa',     'residential', 'Miami',       135000,  195, 4),
  ('villa_mi_4', 'Coral Gables Villa',  'villa',     'residential', 'Miami',        98000,  160, 4),
  ('mansion_mi_2','Star Island Palace', 'mansion',   'residential', 'Miami',       2000000,  410, 8),
  ('mansion_mi_3','Ocean Drive Mansion','mansion',   'residential', 'Miami',       2500000,  500, 8),
  ('penth_mi',   'Brickell Penthouse',  'penthouse', 'residential', 'Miami',       1100000,  300, 6),
  ('yacht_mi',   'Miami Mega Yacht',    'yacht',     'residential', 'Miami',       2800000,  540, 10),

  -- Las Vegas residential
  ('house_lv_2', 'Summerlin Home',      'house',     'residential', 'Las Vegas',    20000,  50, 2),
  ('house_lv_3', 'Henderson Condo',     'house',     'residential', 'Las Vegas',    24000,  60, 2),
  ('house_lv_4', 'North Vegas House',   'house',     'residential', 'Las Vegas',    18000,  46, 2),
  ('house_lv_5', 'Spring Valley Home',  'house',     'residential', 'Las Vegas',    22000,  54, 2),
  ('villa_lv_2', 'Red Rock Villa',      'villa',     'residential', 'Las Vegas',    92000,  150, 4),
  ('villa_lv_3', 'Summerlin Estate',    'villa',     'residential', 'Las Vegas',   108000,  170, 4),
  ('villa_lv_4', 'Lake Las Vegas Villa','villa',     'residential', 'Las Vegas',    85000,  140, 4),
  ('mansion_lv_2','Strip Palace',       'mansion',   'residential', 'Las Vegas',   1750000,  360, 8),
  ('mansion_lv_3','Red Rock Estate',    'mansion',   'residential', 'Las Vegas',   2200000,  440, 8),
  ('penth_lv',   'Vegas Strip Penthouse','penthouse','residential', 'Las Vegas',    950000,  260, 6),
  ('yacht_lv',   'Lake Mead Mega Yacht','yacht',     'residential', 'Las Vegas',   2400000,  480, 10)
ON CONFLICT (id) DO NOTHING;

-- ---- Update purchase_property with new limits and admin bypass ----
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
