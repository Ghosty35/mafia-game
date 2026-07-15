-- ============================================================
-- 043: Fix play_casino() failing intermittently on losing bets
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
--
-- Bug: play_casino() calls add_to_casino_pool() without the public.
-- schema prefix, under SET search_path = ''. Only hit on a LOSING bet
-- (the win branch never calls it), so casino games appeared to work
-- randomly and fail with a generic error specifically when the player
-- lost.
-- ============================================================

CREATE OR REPLACE FUNCTION public.play_casino(game text, bet bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  p public.players;
  win_chance numeric := 0.48;
  won boolean;
  payout bigint := 0;
  pool text := 'general';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF bet < 100 OR bet > 500000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < bet THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  IF game = 'blackjack' THEN
    win_chance := 0.485; pool := 'blackjack';
  ELSIF game = 'roulette' THEN
    win_chance := 0.46; pool := 'roulette';
  ELSE
    win_chance := 0.47; pool := 'general';
  END IF;

  IF COALESCE(p.is_donator, false) THEN
    win_chance := win_chance + 0.015;
  END IF;

  won := random() < win_chance;

  p.cash := p.cash - bet;

  IF won THEN
    payout := FLOOR(bet * 1.95);
    p.cash := p.cash + payout;
  ELSE
    PERFORM public.add_to_casino_pool(pool, bet);
  END IF;

  UPDATE public.players SET cash = p.cash WHERE id = p.id;

  RETURN jsonb_build_object(
    'won', won,
    'bet', bet,
    'payout', payout,
    'new_cash', p.cash,
    'game', game,
    'player', to_jsonb(p)
  );
END;
$function$;
