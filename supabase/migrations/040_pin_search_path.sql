-- ============================================================
-- 040: Pin search_path on functions flagged by Supabase security advisor
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
--
-- calculate_money_rank, get_money_rank, get_family_roles and
-- generate_weekly_bills were missing "SET search_path = ''", unlike
-- every other function in this codebase. No behavior change, just
-- closes the search_path-hijacking gap the advisor flagged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_money_rank(wealth bigint)
RETURNS text
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT CASE
    WHEN wealth < 1000 THEN 'Hobo'
    WHEN wealth < 10000 THEN 'Street Rat'
    WHEN wealth < 50000 THEN 'Small Time Hustler'
    WHEN wealth < 200000 THEN 'Gangster'
    WHEN wealth < 1000000 THEN 'Made Man'
    ELSE 'Kingpin'
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_money_rank(wealth bigint)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF wealth < 1000 THEN RETURN 'Hobo';
  ELSIF wealth < 10000 THEN RETURN 'Street Rat';
  ELSIF wealth < 50000 THEN RETURN 'Small Time Hustler';
  ELSIF wealth < 200000 THEN RETURN 'Gangster';
  ELSIF wealth < 1000000 THEN RETURN 'Made Man';
  ELSE RETURN 'Kingpin';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_roles()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  select array['boss', 'underboss', 'caporegime', 'soldier', 'associate'];
$$;

CREATE OR REPLACE FUNCTION public.generate_weekly_bills()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  p record;
  prop jsonb;
  total_bill bigint;
  tax bigint;
BEGIN
  FOR p IN SELECT * FROM public.players LOOP
    total_bill := 0;
    FOR prop IN SELECT * FROM jsonb_array_elements(p.owned_properties) LOOP
      total_bill := total_bill + (prop->>'maintenance_due')::bigint;
    END LOOP;
    tax := total_bill * 0.05;
    UPDATE public.players SET
      bill_history = COALESCE(bill_history, '[]'::jsonb) || jsonb_build_object(
        'date', now(),
        'total', total_bill + tax,
        'tax', tax,
        'details', p.owned_properties
      ),
      autopay_bills = COALESCE(autopay_bills, false)
    WHERE id = p.id;

    IF p.autopay_bills THEN
      -- deduct logic
    END IF;
  END LOOP;
END;
$$;
