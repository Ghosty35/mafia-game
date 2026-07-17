-- 061_lockdown_pool_and_stock_market.sql
-- =====================================================================
-- SECURITY: close two economy exploits found in the stocks/casino audit.
-- ---------------------------------------------------------------------
-- 1. add_to_casino_pool(text,bigint) was EXECUTE-granted to PUBLIC/anon/
--    authenticated and has NO auth check. Any user could mint arbitrary
--    balances into the pools, then extract cash via enter_weekly_lottery
--    (prize = 8% of the lottery pool once it exceeds 200k). It is only
--    ever meant to be called internally (PERFORM) from buy_stock /
--    play_casino, which run as the function owner and are unaffected by
--    revoking the public grant. -> revoke from everyone.
--
-- 2. advance_stock_market() was EXECUTE-granted to PUBLIC/anon and has no
--    rate limit. The stocks page calls it on every load, so a holder
--    could spam it to reroll the random walk until their stock pumps,
--    then sell_stock high. -> add a GLOBAL time-gate (advance at most
--    once per 60s regardless of caller/frequency) and restrict EXECUTE to
--    authenticated only. Repeated/anon calls become cheap no-ops that
--    just return the current market. The client tick keeps working.
--
-- No frontend change required: get_stock_market + advance_stock_market
-- calls are unchanged for authenticated users.
-- =====================================================================

-- ---------- 1. lock down the casino pool mutator ----------
REVOKE ALL ON FUNCTION public.add_to_casino_pool(text, bigint) FROM public, anon, authenticated;

-- ---------- 2. time-gate the stock market advance ----------
CREATE OR REPLACE FUNCTION public.advance_stock_market()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fam_power numeric;
  crime_total numeric;
  bias numeric := 0;
  rec record;
  new_price numeric;
  delta numeric;
BEGIN
  -- GLOBAL rate limit: only advance if the market hasn't ticked in the
  -- last 60s. Kills the spam-reroll manipulation (pump a held stock by
  -- rerolling the random walk, then sell high) while keeping the
  -- client-driven "live on load" behaviour. Any caller within the window
  -- just gets the current market back.
  IF (SELECT MAX(last_tick) FROM public.stocks) > now() - interval '60 seconds' THEN
    RETURN (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ticker) FROM public.stocks s);
  END IF;

  SELECT COALESCE(SUM(power),0) INTO fam_power FROM public.families;
  SELECT COALESCE(SUM(crimes_succeeded),0) INTO crime_total FROM public.players;

  -- Light positive bias if strong family/crime economy
  bias := LEAST(0.012, (fam_power / 500000.0) + (crime_total / 800000.0));

  FOR rec IN SELECT * FROM public.stocks LOOP
    -- random walk with volatility + small economy bias
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
$function$;

REVOKE ALL ON FUNCTION public.advance_stock_market() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.advance_stock_market() TO authenticated;

-- ---------- 3. fix inverted lottery donator odds ----------
-- Bug: donators had a LOWER win chance (0.14) than non-donators (0.37) —
-- paying customers got worse odds. Give donators a modest edge instead.
-- (Only the win_chance line changed; lottery balance is otherwise intact.)
CREATE OR REPLACE FUNCTION public.enter_weekly_lottery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p public.players;
  win_chance numeric;
  pool bigint;
  prize bigint;
  ticket_cost constant bigint := 5000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.lottery_last_entry IS NOT NULL AND p.lottery_last_entry > now() - interval '7 days' THEN
    RAISE EXCEPTION 'LOTTERY_ON_COOLDOWN';
  END IF;
  IF p.cash < ticket_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  UPDATE public.players SET cash = cash - ticket_cost, lottery_last_entry = now() WHERE id = p.id;
  win_chance := CASE WHEN COALESCE(p.is_donator, false) THEN 0.42 ELSE 0.37 END;
  IF random() >= win_chance THEN
    RETURN jsonb_build_object('won', false, 'ticket_cost', ticket_cost);
  END IF;
  prize := 25000 + floor(random() * 80000)::bigint;
  SELECT lottery INTO pool FROM public.casino_pools WHERE id = 1;
  IF COALESCE(pool, 0) > 200000 THEN
    prize := floor(pool * 0.08)::bigint;
    UPDATE public.casino_pools SET lottery = GREATEST(0, lottery - prize) WHERE id = 1;
  END IF;
  UPDATE public.players SET cash = cash + prize WHERE id = p.id;
  RETURN jsonb_build_object('won', true, 'prize', prize, 'ticket_cost', ticket_cost);
END;
$function$;
