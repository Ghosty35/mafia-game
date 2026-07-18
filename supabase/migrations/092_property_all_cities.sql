-- 092_property_all_cities.sql
-- =====================================================================
-- SPOOR A5 (deel 4) — "all properties in all cities"
-- ---------------------------------------------------------------------
-- De property_catalog had elke bezitting in precies één stad. De UI eist
-- nu dat je in je huidige stad koopt (purchase_property WRONG_CITY check),
-- dus een speler kon elke property-type maar in één stad krijgen.
--
-- Deze migratie kopieert elke bestaande catalogus-property naar ALLE
-- overige steden, met een unieke id "<base>__<city>". De frontend toont
-- iconen op basis van de base-id (suffix wordt gestript), en de purchase
-- RPC werkt gewoon met de per-city catalog_id.
--
-- Re-runbaar: ON CONFLICT (id) DO NOTHING, en we slaan de stad over waar
-- de property al staat.
-- =====================================================================

INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots)
SELECT
  c.id || '__' || v.city,
  c.name,
  c.ptype,
  c.type,
  v.city,
  c.price,
  c.income,
  c.spots
FROM public.property_catalog c
CROSS JOIN (
  VALUES
    ('New York'),
    ('Chicago'),
    ('Los Angeles'),
    ('Miami'),
    ('Las Vegas')
) AS v(city)
WHERE v.city <> c.city
ON CONFLICT (id) DO NOTHING;
