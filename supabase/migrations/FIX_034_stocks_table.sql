-- ============================================================
-- TARGETED FIX: stocks table + dependent functions
-- Run this if you get "relation public.stocks does not exist"
-- when creating get_stock_market or similar.
-- ============================================================

-- 1. Create the stocks table (safe if it already exists)
CREATE TABLE IF NOT EXISTS public.stocks (
  ticker text primary key,
  name text not null,
  current_price numeric(12,2) not null default 100.00,
  prev_price numeric(12,2) not null default 100.00,
  volatility numeric(5,4) not null default 0.03,
  last_tick timestamptz default now()
);

-- 2. Seed the initial stocks (idempotent)
INSERT INTO public.stocks (ticker, name, current_price, prev_price, volatility) VALUES
('GOTHAM', 'Gotham Realty Trust', 142.50, 140.00, 0.025),
('PHARMA', 'Street Pharma Co.', 67.80, 71.20, 0.06),
('FAMPOW', 'Family Power Holdings', 215.00, 208.30, 0.04),
('HEISTX', 'Heist Gear & Logistics', 38.90, 39.50, 0.05),
('RACERZ', 'Raceway Performance Parts', 91.25, 89.00, 0.045),
('CASROY', 'Casino Royale Holdings', 154.00, 150.75, 0.035)
ON CONFLICT (ticker) DO NOTHING;

-- 3. Ensure player column for holdings exists
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS stock_holdings jsonb DEFAULT '{}'::jsonb;

-- 4. Now safe to create/replace the stock functions

CREATE OR REPLACE FUNCTION public.get_stock_market()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ticker) FROM public.stocks s;
$$;

CREATE OR REPLACE FUNCTION public.advance_stock_market()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fam_power numeric;
  crime_total numeric;
  bias numeric := 0;
  rec record;
  new_price numeric;
  delta numeric;
BEGIN
  SELECT COALESCE(SUM(power),0) INTO fam_power FROM public.families;
  SELECT COALESCE(SUM(crimes_succeeded),0) INTO crime_total FROM public.players;

  bias := LEAST(0.012, (fam_power / 500000.0) + (crime_total / 800000.0));

  FOR rec IN SELECT * FROM public.stocks LOOP
    delta := (random() - 0.48) * rec.volatility + bias;
    new_price := GREATEST(5, rec.current_price * (1 + delta));
    UPDATE public.stocks
    SET prev_price = current_price,
        current_price = round(new_price::numeric, 2),
        last_tick = now()
    WHERE ticker = rec.ticker;
  END LOOP;

  RETURN (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ticker) FROM public.stocks s);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_stock(p_ticker text, shares int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.players;
  s record;
  cost numeric;
  current_holdings jsonb;
  new_shares int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF shares < 1 THEN RAISE EXCEPTION 'INVALID_SHARES'; END IF;

  SELECT * INTO p FROM public.players WHERE id=auth.uid() FOR UPDATE;
  SELECT * INTO s FROM public.stocks WHERE ticker = p_ticker;
  IF s.ticker IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STOCK'; END IF;

  cost := s.current_price * shares;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  p.cash := p.cash - cost;
  current_holdings := COALESCE(p.stock_holdings, '{}'::jsonb);
  new_shares := COALESCE((current_holdings->>p_ticker)::int, 0) + shares;
  current_holdings := jsonb_set(current_holdings, ARRAY[p_ticker], to_jsonb(new_shares));

  UPDATE public.players SET cash = p.cash, stock_holdings = current_holdings WHERE id = p.id;

  PERFORM add_to_casino_pool('general', FLOOR(cost * 0.005));

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'shares_bought', shares, 'cost', cost, 'player', to_jsonb(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.sell_stock(p_ticker text, shares int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.players;
  s record;
  revenue numeric;
  current_holdings jsonb;
  owned int;
  new_shares int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF shares < 1 THEN RAISE EXCEPTION 'INVALID_SHARES'; END IF;

  SELECT * INTO p FROM public.players WHERE id=auth.uid() FOR UPDATE;
  SELECT * INTO s FROM public.stocks WHERE ticker = p_ticker;
  IF s.ticker IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STOCK'; END IF;

  current_holdings := COALESCE(p.stock_holdings, '{}'::jsonb);
  owned := COALESCE((current_holdings->>p_ticker)::int, 0);
  IF owned < shares THEN RAISE EXCEPTION 'NOT_ENOUGH_SHARES'; END IF;

  revenue := s.current_price * shares;
  p.cash := p.cash + revenue;
  new_shares := owned - shares;
  IF new_shares <= 0 THEN
    current_holdings := current_holdings - p_ticker;
  ELSE
    current_holdings := jsonb_set(current_holdings, ARRAY[p_ticker], to_jsonb(new_shares));
  END IF;

  UPDATE public.players SET cash = p.cash, stock_holdings = current_holdings WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'shares_sold', shares, 'revenue', revenue, 'player', to_jsonb(p));
END;
$$;

-- Optional: ensure casino pools row exists too (in case)
CREATE TABLE IF NOT EXISTS public.casino_pools (
  id int primary key default 1,
  blackjack bigint not null default 0,
  roulette bigint not null default 0,
  lottery bigint not null default 0,
  general bigint not null default 0,
  updated_at timestamptz default now()
);

INSERT INTO public.casino_pools (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Make sure the helper exists (harmless if already there)
CREATE OR REPLACE FUNCTION public.add_to_casino_pool(pool_name text, amount bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF amount <= 0 THEN RETURN; END IF;
  INSERT INTO public.casino_pools (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  UPDATE public.casino_pools SET
    blackjack = blackjack + CASE WHEN pool_name='blackjack' THEN amount ELSE 0 END,
    roulette = roulette + CASE WHEN pool_name='roulette' THEN amount ELSE 0 END,
    lottery = lottery + CASE WHEN pool_name='lottery' THEN amount ELSE 0 END,
    general = general + CASE WHEN pool_name='general' THEN amount ELSE 0 END,
    updated_at = now()
  WHERE id=1;
END;
$$;

COMMENT ON TABLE public.stocks IS 'Stock market table - created via targeted fix';