-- 100_race_hardening.sql
-- P0: Fix race escrow — make races zero-sum.
-- P1: Add missing jail/death checks to race RPCs.
-- P1: Lock both players + race row FOR UPDATE in run_race.

-- ---------- post_race: add DEAD check ----------
CREATE OR REPLACE FUNCTION public.post_race(car_name text, bet bigint, expire_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fee bigint;
  new_race_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF bet < 100 OR bet > 1000000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  fee := GREATEST(100, floor(bet * 0.1))::bigint;
  IF p.cash < fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - fee WHERE id = p.id;

  INSERT INTO public.races (poster_id, poster_name, car_name, bet, entry_fee, expire_at)
  VALUES (p.id, p.username, car_name, bet, fee, now() + make_interval(mins => GREATEST(5, LEAST(240, expire_minutes))))
  RETURNING id INTO new_race_id;

  PERFORM public.log_event('race', COALESCE(p.username, 'Someone') || ' posted a $' || bet || ' street race!');

  RETURN jsonb_build_object('success', true, 'race_id', new_race_id, 'entry_fee', fee);
END;
$$;

-- ---------- join_race: add DEAD check ----------
CREATE OR REPLACE FUNCTION public.join_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  r public.races;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;

  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'RACE_NOT_OPEN'; END IF;
  IF r.poster_id = p.id THEN RAISE EXCEPTION 'CANNOT_JOIN_OWN_RACE'; END IF;
  IF r.expire_at IS NOT NULL AND r.expire_at < now() THEN RAISE EXCEPTION 'RACE_EXPIRED'; END IF;
  IF p.cash < r.entry_fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - r.entry_fee WHERE id = p.id;

  UPDATE public.races
  SET joined_by = p.id, joined_name = p.username, status = 'ready'
  WHERE id = race_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- cancel_race: add jail/death checks, refund joiner too ----------
CREATE OR REPLACE FUNCTION public.cancel_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.races;
  p public.players;
  refund_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;

  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.poster_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOUR_RACE'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'RACE_NOT_OPEN'; END IF;

  refund_total := r.entry_fee;
  IF r.joined_by IS NOT NULL THEN
    refund_total := refund_total + r.entry_fee;
    UPDATE public.players SET cash = cash + r.entry_fee WHERE id = r.joined_by;
  END IF;

  UPDATE public.players SET cash = cash + refund_total WHERE id = r.poster_id;
  UPDATE public.races SET status = 'cancelled' WHERE id = race_id;

  RETURN jsonb_build_object('success', true, 'refunded', refund_total);
END;
$$;

-- ---------- run_race: zero-sum pot payout, lock both players ----------
CREATE OR REPLACE FUNCTION public.run_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r public.races;
  caller uuid;
  poster public.players;
  joiner public.players;
  poster_wins boolean;
  winner_id uuid;
  loser_id uuid;
  w_name text;
  pot bigint;
BEGIN
  caller := auth.uid();
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.status <> 'ready' THEN RAISE EXCEPTION 'RACE_NOT_READY'; END IF;
  IF caller <> r.poster_id AND caller <> r.joined_by THEN RAISE EXCEPTION 'NOT_YOUR_RACE'; END IF;

  SELECT * INTO poster FROM public.players WHERE id = r.poster_id FOR UPDATE;
  IF poster.death_until IS NOT NULL AND poster.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF poster.jailed_until IS NOT NULL AND poster.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  SELECT * INTO joiner FROM public.players WHERE id = r.joined_by FOR UPDATE;
  IF joiner.death_until IS NOT NULL AND joiner.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF joiner.jailed_until IS NOT NULL AND joiner.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  poster_wins := random() < 0.5;
  winner_id := CASE WHEN poster_wins THEN r.poster_id ELSE r.joined_by END;
  loser_id  := CASE WHEN poster_wins THEN r.joined_by ELSE r.poster_id END;
  w_name    := CASE WHEN poster_wins THEN r.poster_name ELSE r.joined_name END;

  pot := r.entry_fee * 2;

  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + pot WHERE id = winner_id;
  UPDATE public.races SET status = 'finished', winner_name = w_name WHERE id = race_id;

  IF winner_id = caller THEN
    PERFORM public.record_hustler_progress('race', 1);
    PERFORM public.bump_player_stat('race');
  END IF;

  PERFORM public.log_event('race', COALESCE(w_name, 'Someone') || ' won a $' || pot || ' street race!');
  RETURN jsonb_build_object('success', true, 'winner', w_name, 'pot', pot, 'you_won', winner_id = caller);
END;
$function$;
