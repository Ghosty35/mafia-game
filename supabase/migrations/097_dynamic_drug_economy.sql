-- 097_dynamic_drug_economy.sql
-- =====================================================================
-- Dynamic drug economy — ROTATING city price profiles
-- ---------------------------------------------------------------------
-- The street dealer already recomputes prices every 4 hours (the
-- bucket = floor(epoch / 4h) window). Previously each city had a FIXED
-- multiplier profile, so the cheapest/most-expensive city for a drug
-- never changed — one "perfect route" existed forever.
--
-- Now the five multiplier profiles ROTATE across the five cities every
-- 4h window. Prices stay stable within a window (unchanged cadence),
-- but each rollover the hot city for each drug shifts. Players must
-- watch the market and travel to find the best buy/sell city.
--
-- Deterministic (same for all players), server-authoritative — no new
-- exploit surface. Only _drug_price changes; buy_drug/sell_drug keep
-- their tax, caps and dirty-cash payout untouched.
--
-- Also adds:
--   * _drug_bucket_end()   : timestamptz when the current window rolls
--   * get_all_drug_prices(): every city's 4 prices at once (market board)
-- =====================================================================

-- ---------- rotating price helper ----------
CREATE OR REPLACE FUNCTION public._drug_price(p_city text, p_drug text)
RETURNS int
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  bucket   bigint;
  city_idx int;
  prof_idx int;
  mult     numeric;
  base     numeric;
  jitter   numeric;
  h        int;
  r        numeric;
  d        int;
BEGIN
  d := public._drug_idx(p_drug);
  IF d IS NULL THEN RETURN NULL; END IF;

  -- 4-hour window (same cadence as before).
  bucket := floor(extract(epoch FROM now()) / (4 * 3600))::bigint;

  -- Stable pseudo-random jitter in [0,1) from city|drug|window.
  h := ('x' || substr(md5(p_city || '|' || p_drug || '|' || bucket::text), 1, 8))::bit(32)::int;
  r := (abs(h) % 10000)::numeric / 10000.0;

  -- City -> its fixed index 0..4.
  city_idx := CASE p_city
    WHEN 'New York'    THEN 0
    WHEN 'Chicago'     THEN 1
    WHEN 'Los Angeles' THEN 2
    WHEN 'Miami'       THEN 3
    WHEN 'Las Vegas'   THEN 4
    ELSE -1
  END;

  IF city_idx < 0 THEN
    mult := 1.0;   -- unknown city: neutral
  ELSE
    -- ROTATE: every window each city adopts a different profile.
    prof_idx := ((city_idx + bucket) % 5)::int;
    mult := CASE prof_idx
      WHEN 0 THEN (ARRAY[0.7,1.3,1.1,0.9])[d]   -- profile A (was New York)
      WHEN 1 THEN (ARRAY[1.4,0.8,0.9,1.2])[d]   -- profile B (was Chicago)
      WHEN 2 THEN (ARRAY[1.1,0.6,1.4,0.8])[d]   -- profile C (was Los Angeles)
      WHEN 3 THEN (ARRAY[0.9,1.2,0.7,1.5])[d]   -- profile D (was Miami)
      ELSE        (ARRAY[1.3,1.0,1.2,0.7])[d]   -- profile E (was Las Vegas)
    END;
  END IF;

  -- Base + jitter range per drug (unchanged).
  base   := (ARRAY[90, 55, 160, 35])[d];
  jitter := (ARRAY[40, 30, 60, 25])[d];

  RETURN floor(base * mult + r * jitter)::int;
END;
$$;

-- ---------- when does the current 4h window end? ----------
CREATE OR REPLACE FUNCTION public._drug_bucket_end()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT to_timestamp((floor(extract(epoch FROM now()) / (4 * 3600)) + 1) * (4 * 3600));
$$;

-- ---------- read: all cities' prices for the market board ----------
CREATE OR REPLACE FUNCTION public.get_all_drug_prices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cities text[] := ARRAY['New York','Chicago','Los Angeles','Miami','Las Vegas'];
  c text;
  arr jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  FOREACH c IN ARRAY cities LOOP
    arr := arr || jsonb_build_array(jsonb_build_object(
      'city',  c,
      'Coke',  public._drug_price(c, 'Coke'),
      'Weed',  public._drug_price(c, 'Weed'),
      'Meth',  public._drug_price(c, 'Meth'),
      'Pills', public._drug_price(c, 'Pills')
    ));
  END LOOP;

  RETURN jsonb_build_object('cities', arr, 'rotates_at', public._drug_bucket_end());
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_drug_prices() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_all_drug_prices() TO authenticated;

-- ---------- single-city read (adds rotates_at for the UI countdown) ----------
CREATE OR REPLACE FUNCTION public.get_drug_prices(p_city text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  c := COALESCE(p_city, (SELECT current_city FROM public.players WHERE id = auth.uid()), 'New York');

  RETURN jsonb_build_object(
    'Coke',       public._drug_price(c, 'Coke'),
    'Weed',       public._drug_price(c, 'Weed'),
    'Meth',       public._drug_price(c, 'Meth'),
    'Pills',      public._drug_price(c, 'Pills'),
    'city',       c,
    'rotates_at', public._drug_bucket_end()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_drug_prices(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_drug_prices(text) TO authenticated;
