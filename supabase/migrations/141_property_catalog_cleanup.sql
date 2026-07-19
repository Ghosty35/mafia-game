-- 141_property_catalog_cleanup.sql
-- Remove duplicate legacy property catalog entries that were superseded by
-- city-specific IDs in migration 092. Each city should have exactly one of
-- each property type.

-- Legacy IDs from migration 055 that conflict with 092's city-scoped IDs:
DELETE FROM public.property_catalog
WHERE id IN ('mf1', 'gb1', 'mansion1', 'da1', 'h1', 'ts1');

-- Prevent future duplicate (city, name, ptype) combos.
-- A property name within a city + type must be unique.
ALTER TABLE public.property_catalog
  ADD CONSTRAINT property_catalog_city_name_type_key
  UNIQUE (city, name, ptype);
