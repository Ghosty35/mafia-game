-- 155_drug_caps_from_economy_config.sql
-- Make _drug_cap() read from get_economy_config() instead of hardcoded values.
-- This ensures all drug-cap enforcement (buy_drug, buy_drugs_from_listing, etc.)
-- uses a single source of truth.

BEGIN;

CREATE OR REPLACE FUNCTION public._drug_cap(p_drug text)
RETURNS int
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((public.get_economy_config() -> 'drug_caps' ->> p_drug)::int, 0);
$$;

COMMIT;
