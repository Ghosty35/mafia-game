-- 045_server_side_drug_market.sql
-- =====================================================================
-- FASE 1 / Spoor A2 — Server-authoritative street dealer
-- ---------------------------------------------------------------------
-- Vervangt de client-authoritative drugshandel (apply_action met
-- client-berekende prijzen) door dedicated RPCs met server-side prijzen.
--
--   * _drug_price(city, drug)  : deterministische prijs per stad per 4u-venster
--   * get_drug_prices(city)    : jsonb met alle 4 prijzen (client toont exact
--                                 wat de server rekent)
--   * buy_drug(drug, qty)      : koopt tegen server-prijs, 1.5% tax, caps
--   * sell_drug(drug, qty)     : verkoopt tegen server-prijs
--
-- Prijzen zijn identiek voor alle spelers binnen hetzelfde 4-uursvenster
-- (hash van stad|drug|tijdvenster) -> buy-low-sell-high blijft werken,
-- maar niemand kan de prijs of opbrengst faken.
-- =====================================================================

-- ---------- leaf-helpers (eerst, want _drug_price gebruikt ze) ----------
-- index-helper: Coke=1, Weed=2, Meth=3, Pills=4
CREATE OR REPLACE FUNCTION public._drug_idx(p_drug text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_drug
    WHEN 'Coke'  THEN 1
    WHEN 'Weed'  THEN 2
    WHEN 'Meth'  THEN 3
    WHEN 'Pills' THEN 4
    ELSE NULL
  END;
$$;

-- cap-helper (server-side carry limits)
CREATE OR REPLACE FUNCTION public._drug_cap(p_drug text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_drug
    WHEN 'Coke'  THEN 200
    WHEN 'Weed'  THEN 1000
    WHEN 'Meth'  THEN 100
    WHEN 'Pills' THEN 300
    ELSE 0
  END;
$$;

-- ---------- deterministische prijs-helper ----------
-- Spiegelt de oude client-formule (base * city_mult + jitter), maar de
-- jitter is nu een stabiele hash i.p.v. Math.random().
CREATE OR REPLACE FUNCTION public._drug_price(p_city text, p_drug text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  bucket  bigint;
  mult    numeric;
  base    numeric;
  jitter  numeric;
  h       int;
  r       numeric;
BEGIN
  -- 4-uursvenster (zelfde cadans als de oude UI).
  bucket := floor(extract(epoch FROM now()) / (4 * 3600))::bigint;

  -- Stabiele pseudo-random in [0,1) uit stad|drug|venster.
  h := ('x' || substr(md5(p_city || '|' || p_drug || '|' || bucket::text), 1, 8))::bit(32)::int;
  r := (abs(h) % 10000)::numeric / 10000.0;

  -- City-multipliers (bron: oude app/street-dealer getCityMultipliers).
  mult := CASE p_city
    WHEN 'New York'    THEN (ARRAY[0.7,1.3,1.1,0.9])[public._drug_idx(p_drug)]
    WHEN 'Chicago'     THEN (ARRAY[1.4,0.8,0.9,1.2])[public._drug_idx(p_drug)]
    WHEN 'Los Angeles' THEN (ARRAY[1.1,0.6,1.4,0.8])[public._drug_idx(p_drug)]
    WHEN 'Miami'       THEN (ARRAY[0.9,1.2,0.7,1.5])[public._drug_idx(p_drug)]
    WHEN 'Las Vegas'   THEN (ARRAY[1.3,1.0,1.2,0.7])[public._drug_idx(p_drug)]
    ELSE 1.0
  END;

  -- Base + jitter-range per drug (bron: oude UI formule).
  base   := (ARRAY[90, 55, 160, 35])[public._drug_idx(p_drug)];
  jitter := (ARRAY[40, 30, 60, 25])[public._drug_idx(p_drug)];

  RETURN floor(base * mult + r * jitter)::int;
END;
$$;


-- ---------- read: current prices for a city ----------
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
  -- Val terug op de eigen stad wanneer er geen expliciete stad is meegegeven.
  c := COALESCE(p_city, (SELECT current_city FROM public.players WHERE id = auth.uid()), 'New York');

  RETURN jsonb_build_object(
    'Coke',  public._drug_price(c, 'Coke'),
    'Weed',  public._drug_price(c, 'Weed'),
    'Meth',  public._drug_price(c, 'Meth'),
    'Pills', public._drug_price(c, 'Pills'),
    'city',  c
  );
END;
$$;


-- ---------- buy: server-side price + tax + cap ----------
CREATE OR REPLACE FUNCTION public.buy_drug(p_drug text, p_qty int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  unit_price int;
  cost bigint;
  tax bigint;
  total bigint;
  have int;
  cap int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  unit_price := public._drug_price(p.current_city, p_drug);
  cost  := unit_price::bigint * p_qty;
  tax   := floor(cost * 0.015)::bigint;   -- 1.5% Community Tax Fund
  total := cost + tax;

  IF p.cash < total THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  cap  := public._drug_cap(p_drug);
  IF have + p_qty > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  new_storage := jsonb_set(
    COALESCE(p.drug_storage, '{}'::jsonb),
    ARRAY[p_drug],
    to_jsonb(have + p_qty)
  );

  UPDATE public.players
  SET cash = cash - total,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      drug_storage = new_storage
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty,
                            'unit_price', unit_price, 'tax', tax, 'total', total,
                            'storage', new_storage);
END;
$$;


-- ---------- sell: server-side price ----------
CREATE OR REPLACE FUNCTION public.sell_drug(p_drug text, p_qty int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  unit_price int;
  revenue bigint;
  have int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;

  unit_price := public._drug_price(p.current_city, p_drug);
  revenue := unit_price::bigint * p_qty;

  new_storage := jsonb_set(
    COALESCE(p.drug_storage, '{}'::jsonb),
    ARRAY[p_drug],
    to_jsonb(have - p_qty)
  );

  UPDATE public.players
  SET cash = cash + revenue,
      drug_storage = new_storage
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty,
                            'unit_price', unit_price, 'revenue', revenue,
                            'storage', new_storage);
END;
$$;
