-- 085_get_property_catalog.sql
-- =====================================================================
-- Leest de property_catalog (referentiedata, leesbaar voor authenticated).
-- De frontend gebruikt dit in plaats van een hardcoded array.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_property_catalog(p_city text DEFAULT NULL)
RETURNS TABLE (
  id text,
  name text,
  ptype text,
  type text,
  city text,
  price bigint,
  income bigint,
  spots int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id, name, ptype, type, city, price, income, spots
  FROM public.property_catalog
  WHERE p_city IS NULL OR city = p_city
  ORDER BY
    CASE type WHEN 'residential' THEN 0 ELSE 1 END,
    price ASC;
$$;

REVOKE ALL ON FUNCTION public.get_property_catalog(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_property_catalog(text) TO authenticated;
