-- 055_property_catalog_and_hardened_purchase.sql
-- =====================================================================
-- SPOOR A5 (deel 1) — server-authoritative property purchase
-- ---------------------------------------------------------------------
-- De oude purchase_property(prop jsonb, price bigint) vertrouwde een
-- CLIENT-opgegeven price (alleen > 0 gecheckt) en een volledig client-
-- gebouwd prop-object. Exploits:
--   * koop de $1.5M Mansion voor price:1
--   * inject income:999999 -> idle-income geldkraan
--   * per-type limieten (1 mansion / 2 villa / 4 house) waren client-only
--
-- Nu: property_catalog met canonieke price/income/type/city/spots. De
-- nieuwe purchase_property(catalog_id, custom_name) haalt ALLE economische
-- waarden server-side uit de catalogus, dwingt de limieten server-side af
-- en bouwt het property-record zelf. De oude (jsonb,bigint)-variant wordt
-- gedropt zodat de exploitbare signatuur verdwijnt.
--
-- owned_properties blijft server-owned JSON (geen tabel-normalisatie); alle
-- mutaties lopen voortaan via dedicated RPC's.
-- =====================================================================

-- ---------- canonieke catalogus (bron: real-estate/page.tsx allProperties) ----------
CREATE TABLE IF NOT EXISTS public.property_catalog (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  ptype      text NOT NULL,            -- mansion | villa | house | agency
  type       text NOT NULL,            -- residential | agency
  city       text NOT NULL,
  price      bigint NOT NULL,
  income     bigint NOT NULL,
  spots      int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots) VALUES
  ('ts1',        'Train Station',   'agency',  'agency',      'New York',    25000,  100, 0),
  ('house1',     'House',           'house',   'residential', 'New York',    15000,   40, 2),
  ('mf1',        'Metal Factory',   'agency',  'agency',      'Chicago',     45000,  240, 0),
  ('villa1',     'Villa',           'villa',   'residential', 'Chicago',     75000,  120, 4),
  ('da1',        'Detective Agency','agency',  'agency',      'Los Angeles', 30000,  160, 0),
  ('house_la',   'House',           'house',   'residential', 'Los Angeles', 16000,   42, 2),
  ('h1',         'Hospital',        'agency',  'agency',      'Miami',       35000,  180, 0),
  ('villa_mi',   'Villa',           'villa',   'residential', 'Miami',       78000,  125, 4),
  ('gb1',        'General Bank',    'agency',  'agency',      'Las Vegas',   80000,  400, 0),
  ('mansion1',   'Mansion',         'mansion', 'residential', 'Las Vegas', 1500000,  300, 8),
  ('house_chi',  'House',           'house',   'residential', 'Chicago',     15500,   41, 2),
  ('mansion_la', 'Mansion',         'mansion', 'residential', 'Los Angeles',1550000,  295, 8),
  ('house_mi',   'House',           'house',   'residential', 'Miami',       15200,   39, 2),
  ('villa_lv',   'Villa',           'villa',   'residential', 'Las Vegas',   82000,  130, 4)
ON CONFLICT (id) DO NOTHING;

-- catalogus is referentiedata: RLS aan, RPC-only (geen policy), zoals car_catalog.
ALTER TABLE public.property_catalog ENABLE ROW LEVEL SECURITY;

-- ---------- helper: tel eigen properties van een bepaald ptype ----------
-- Werkt voor nieuwe records (ptype-veld) en legacy (val terug op name-parse).
CREATE OR REPLACE FUNCTION public._count_owned_ptype(p_owned jsonb, p_ptype text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM jsonb_array_elements(COALESCE(p_owned, '[]'::jsonb)) e
  WHERE lower(COALESCE(e->>'ptype', e->>'name', '')) LIKE '%' || p_ptype || '%';
$$;

-- ---------- oude exploitbare signatuur weg ----------
DROP FUNCTION IF EXISTS public.purchase_property(jsonb, bigint);

-- ---------- nieuwe server-authoritative purchase ----------
CREATE OR REPLACE FUNCTION public.purchase_property(p_catalog_id text, p_custom_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  -- ---- server-side limieten ----
  -- Je kunt alleen kopen in de stad waar je bent (UI toont sowieso enkel
  -- current-city properties; nu ook server-side afgedwongen).
  IF cat.city <> COALESCE(p.current_city, 'New York') THEN
    RAISE EXCEPTION 'WRONG_CITY';
  END IF;

  IF jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) >= 4 THEN
    RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
  END IF;

  -- niet dezelfde catalogus-property dubbel (dekt ook "1 house per stad", want
  -- elke stad heeft precies 1 house/villa/mansion-catalogus-id).
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

  -- ---- prijs + belasting: SERVER-side uit catalogus ----
  tax        := floor(cat.price * 0.10)::bigint;
  total_cost := cat.price + tax;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  -- ---- server-gebouwd record (client kan geen velden forgen) ----
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
$$;

REVOKE ALL ON FUNCTION public.purchase_property(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.purchase_property(text, text) TO authenticated;
