-- ============================================================
-- 036: Real idle income, real game events, multiplayer races,
--      territory control and player roles.
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- (run 035_admin_tools_and_persistence.sql FIRST if you haven't)
-- ============================================================

-- ============================================================
-- A) REAL IDLE INCOME
-- Properties accrue income server-side since last_earned (cap 24h).
-- 20% tax is added to the property's maintenance bill, the net goes
-- to the property bank. Collect moves property bank -> player cash.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tick_property_income()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  income bigint;
  hours numeric;
  earned bigint;
  tax bigint;
  net bigint;
  total_net bigint := 0;
  last_ts timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF p.owned_properties IS NULL OR jsonb_array_length(p.owned_properties) = 0 THEN
    RETURN jsonb_build_object('success', true, 'earned', 0);
  END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(p.owned_properties) LOOP
    income := COALESCE((el->>'income')::bigint, 50);
    last_ts := COALESCE((el->>'last_earned')::timestamptz, now() - interval '1 hour');
    hours := LEAST(24, GREATEST(0, EXTRACT(epoch FROM (now() - last_ts)) / 3600.0));

    IF hours >= 0.1 THEN
      earned := floor(income * hours)::bigint;
      tax := floor(earned * 0.20)::bigint;   -- 20% business tax -> bill
      net := earned - tax;
      total_net := total_net + net;

      el := jsonb_set(el, '{bank_balance}', to_jsonb(COALESCE((el->>'bank_balance')::bigint, 0) + net));
      el := jsonb_set(el, '{earnings_week}', to_jsonb(COALESCE((el->>'earnings_week')::bigint, 0) + earned));
      el := jsonb_set(el, '{maintenance_due}', to_jsonb(COALESCE((el->>'maintenance_due')::bigint, 0) + tax));
      el := jsonb_set(el, '{last_earned}', to_jsonb(now()));
    END IF;

    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  UPDATE public.players SET owned_properties = new_props WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'earned', total_net);
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_property_income(prop_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
  amount bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      amount := COALESCE((el->>'bank_balance')::bigint, 0);
      IF amount <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_COLLECT'; END IF;
      el := jsonb_set(el, '{bank_balance}', to_jsonb(0));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash + amount, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'collected', amount);
END;
$$;

-- ============================================================
-- B) REAL GAME EVENTS (feeds the LiveLogs widget)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  username text,
  event_type text NOT NULL,
  message text NOT NULL
);

ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Logged in players can read events" ON public.game_events;
CREATE POLICY "Logged in players can read events"
  ON public.game_events FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- No insert/update/delete policies: writes go through log_event().

CREATE OR REPLACE FUNCTION public.log_event(event_type text, message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uname text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(message) > 200 THEN message := left(message, 200); END IF;

  SELECT username INTO uname FROM public.players WHERE id = auth.uid();

  INSERT INTO public.game_events (username, event_type, message)
  VALUES (uname, event_type, message);

  -- Keep the table small: prune old events occasionally
  IF random() < 0.02 THEN
    DELETE FROM public.game_events
    WHERE id NOT IN (SELECT id FROM public.game_events ORDER BY id DESC LIMIT 500);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_recent_events(limit_count int DEFAULT 15)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', id, 'created_at', created_at, 'username', username,
    'event_type', event_type, 'message', message
  )
  FROM public.game_events
  ORDER BY id DESC
  LIMIT LEAST(limit_count, 50);
END;
$$;

-- ============================================================
-- C) MULTIPLAYER RACES (posted races live in the database)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.races (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  poster_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  poster_name text,
  car_name text,
  bet bigint NOT NULL,
  entry_fee bigint NOT NULL,
  status text NOT NULL DEFAULT 'open',  -- open | ready | finished | cancelled
  joined_by uuid,
  joined_name text,
  winner_name text,
  expire_at timestamptz
);

ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Logged in players can view races" ON public.races;
CREATE POLICY "Logged in players can view races"
  ON public.races FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- Writes go through the RPCs below.

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

CREATE OR REPLACE FUNCTION public.run_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.races;
  caller uuid;
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

  poster_wins := random() < 0.5;
  winner_id := CASE WHEN poster_wins THEN r.poster_id ELSE r.joined_by END;
  loser_id  := CASE WHEN poster_wins THEN r.joined_by ELSE r.poster_id END;
  w_name    := CASE WHEN poster_wins THEN r.poster_name ELSE r.joined_name END;
  pot := r.bet * 2;

  UPDATE public.players SET cash = cash + pot WHERE id = winner_id;
  UPDATE public.players SET cash = GREATEST(0, cash - r.bet) WHERE id = loser_id;

  UPDATE public.races SET status = 'finished', winner_name = w_name WHERE id = race_id;

  PERFORM public.log_event('race', COALESCE(w_name, 'Someone') || ' won a $' || pot || ' street race!');

  RETURN jsonb_build_object('success', true, 'winner', w_name, 'pot', pot,
                            'you_won', winner_id = caller);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_race(race_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.races;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;

  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.poster_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOUR_RACE'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'RACE_NOT_OPEN'; END IF;

  -- Refund the entry fee
  UPDATE public.players SET cash = cash + r.entry_fee WHERE id = r.poster_id;
  UPDATE public.races SET status = 'cancelled' WHERE id = race_id;

  RETURN jsonb_build_object('success', true, 'refunded', r.entry_fee);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_open_races()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT to_jsonb(r.*)
  FROM public.races r
  WHERE r.status IN ('open', 'ready')
    AND (r.expire_at IS NULL OR r.expire_at > now() OR r.status = 'ready')
  ORDER BY r.created_at DESC
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_race_history()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT to_jsonb(r.*)
  FROM public.races r
  WHERE r.status = 'finished'
    AND (r.poster_id = auth.uid() OR r.joined_by = auth.uid())
  ORDER BY r.created_at DESC
  LIMIT 10;
END;
$$;

-- ============================================================
-- D) TERRITORY CONTROL (families claim cities with family power)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.territories (
  city text PRIMARY KEY,
  owner_family_id uuid REFERENCES public.families(id) ON DELETE SET NULL,
  owner_family_name text,
  power_invested bigint NOT NULL DEFAULT 0,
  claimed_at timestamptz
);

INSERT INTO public.territories (city) VALUES
  ('New York'), ('Chicago'), ('Los Angeles'), ('Miami'), ('Las Vegas')
ON CONFLICT (city) DO NOTHING;

ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Territories are readable by logged in players" ON public.territories;
CREATE POLICY "Territories are readable by logged in players"
  ON public.territories FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Claim (or take over) a city. Costs family power:
-- unclaimed = 500 power, takeover = 125% of the current investment.
-- Only boss/underboss can claim.
CREATE OR REPLACE FUNCTION public.claim_territory(p_city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t public.territories;
  fam_id uuid;
  my_role text;
  fam public.families;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT family_id, role INTO fam_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();

  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF my_role NOT IN ('boss', 'underboss') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO t FROM public.territories WHERE city = p_city FOR UPDATE;
  IF t.city IS NULL THEN RAISE EXCEPTION 'CITY_NOT_FOUND'; END IF;
  IF t.owner_family_id = fam_id THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = fam_id FOR UPDATE;

  cost := CASE
    WHEN t.owner_family_id IS NULL THEN 500
    ELSE GREATEST(500, floor(t.power_invested * 1.25))::bigint
  END;

  IF COALESCE(fam.power, 0) < cost THEN
    RAISE EXCEPTION 'NOT_ENOUGH_FAMILY_POWER: need %', cost;
  END IF;

  UPDATE public.families SET power = power - cost WHERE id = fam_id;

  UPDATE public.territories
  SET owner_family_id = fam_id,
      owner_family_name = fam.name,
      power_invested = cost,
      claimed_at = now()
  WHERE city = p_city;

  PERFORM public.log_event('territory', fam.name || ' claimed ' || p_city || ' (' || cost || ' power)!');

  RETURN jsonb_build_object('success', true, 'city', p_city, 'cost', cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_territories()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT to_jsonb(t.*) FROM public.territories t ORDER BY t.city;
END;
$$;

-- ============================================================
-- E) PLAYER ROLES (specializations)
-- ============================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS player_role text;

-- First pick is free, switching costs $100,000.
CREATE OR REPLACE FUNCTION public.choose_role(new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  switch_cost bigint := 100000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF new_role NOT IN ('enforcer', 'hustler', 'underboss', 'hitman', 'dealer') THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF p.player_role IS NULL THEN
    UPDATE public.players SET player_role = new_role WHERE id = p.id;
    RETURN jsonb_build_object('success', true, 'role', new_role, 'cost', 0);
  END IF;

  IF p.player_role = new_role THEN RAISE EXCEPTION 'ALREADY_THIS_ROLE'; END IF;
  IF p.cash < switch_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET player_role = new_role, cash = cash - switch_cost WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'role', new_role, 'cost', switch_cost);
END;
$$;
