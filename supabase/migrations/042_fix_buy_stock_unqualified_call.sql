-- ============================================================
-- 042: Fix buy_stock() failing on every purchase
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
--
-- Bug: buy_stock() calls add_to_casino_pool() without the public.
-- schema prefix, but buy_stock has SET search_path = ''. With an
-- empty search_path, Postgres can't resolve the unqualified function
-- name, so every stock purchase raised "function add_to_casino_pool(...)
-- does not exist" and failed -- the frontend just showed the generic
-- "Buy failed" message since the Supabase JS error object isn't a
-- native Error instance.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_stock(p_ticker text, shares integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  -- Small tax to gov/casino (0.5%)
  PERFORM public.add_to_casino_pool('general', FLOOR(cost * 0.005)::bigint);

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'shares_bought', shares, 'cost', cost, 'player', to_jsonb(p));
END;
$function$;
