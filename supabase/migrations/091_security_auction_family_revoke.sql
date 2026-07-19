-- ============================================================
-- 091_security_auction_family_revoke.sql
-- ============================================================
-- Fixes:
--   1) auction_bid / auction_buy_now: lock outbid player before
--      refunding their bid to prevent race-condition double-refund.
--   2) create_family: add server-side creation cost (2M cash OR 200
--      diamonds), matching the design from 029.
--   3) Defense-in-depth: REVOKE ALL ON ALL FUNCTIONS FROM anon so
--      anonymous callers cannot invoke any public RPC at the grant
--      layer. Functions still enforce auth internally.
-- ============================================================

-- ---------- 1) auction_bid: lock outbid player ----------
CREATE OR REPLACE FUNCTION public.auction_bid(p_auction_id uuid, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_min bigint;
  v_space int;
  v_have  int;
  v_old  public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM public._settle_auctions();
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.ends_at <= now() THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.seller_id = p.id THEN RAISE EXCEPTION 'CANNOT_BID_OWN'; END IF;
  IF a.current_bidder = p.id THEN RAISE EXCEPTION 'ALREADY_HIGH_BIDDER'; END IF;
  IF a.item_type = 'property' THEN
    IF NOT public._can_hold_property(p.id, a.property_json) THEN RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED'; END IF;
  ELSE
    v_space := public._max_cars(p.id);
    SELECT count(*) INTO v_have FROM public.player_cars WHERE player_id = p.id;
    IF v_have >= v_space THEN RAISE EXCEPTION 'GARAGE_FULL'; END IF;
  END IF;
  v_min := CASE WHEN a.current_bid IS NULL THEN a.start_price ELSE a.current_bid + greatest(100, floor(a.current_bid * 0.05)::bigint) END;
  IF p_amount < v_min THEN RAISE EXCEPTION 'BID_TOO_LOW'; END IF;
  IF p.cash < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  UPDATE public.players SET cash = cash - p_amount WHERE id = p.id;
  IF a.current_bidder IS NOT NULL THEN
    -- Lock the outbid player before crediting to prevent race-condition
    -- double-refund if two bids land simultaneously.
    SELECT * INTO v_old FROM public.players WHERE id = a.current_bidder FOR UPDATE;
    UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder;
  END IF;
  UPDATE public.auctions SET current_bid = p_amount, current_bidder = p.id, ends_at = greatest(ends_at, now() + interval '2 minutes') WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, p_amount);
  RETURN jsonb_build_object('success', true, 'bid', p_amount, 'min_next', p_amount + greatest(100, floor(p_amount * 0.05)::bigint), 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;

-- ---------- 2) auction_buy_now: lock outbid player ----------
CREATE OR REPLACE FUNCTION public.auction_buy_now(p_auction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_space int;
  v_have  int;
  v_old  public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM public._settle_auctions();
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.buy_now IS NULL THEN RAISE EXCEPTION 'NO_BUY_NOW'; END IF;
  IF a.seller_id = p.id THEN RAISE EXCEPTION 'CANNOT_BID_OWN'; END IF;
  IF a.current_bid IS NOT NULL AND a.current_bid >= a.buy_now THEN RAISE EXCEPTION 'BIDDING_PASSED_BUYNOW'; END IF;
  IF p.cash < a.buy_now THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  IF a.item_type = 'property' THEN
    IF NOT public._can_hold_property(p.id, a.property_json) THEN RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED'; END IF;
  ELSE
    v_space := public._max_cars(p.id);
    SELECT count(*) INTO v_have FROM public.player_cars WHERE player_id = p.id;
    IF v_have >= v_space THEN RAISE EXCEPTION 'GARAGE_FULL'; END IF;
  END IF;
  UPDATE public.players SET cash = cash - a.buy_now WHERE id = p.id;
  IF a.current_bidder IS NOT NULL THEN
    -- Lock the outbid player before crediting to prevent race-condition
    -- double-refund if buy_now and a bid land simultaneously.
    SELECT * INTO v_old FROM public.players WHERE id = a.current_bidder FOR UPDATE;
    UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder;
  END IF;
  UPDATE public.auctions SET current_bid = a.buy_now, current_bidder = p.id, ends_at = now() WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, a.buy_now);
  PERFORM public._settle_auctions();
  RETURN jsonb_build_object('success', true, 'paid', a.buy_now, 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;

-- ---------- 3) create_family: add server-side cost ----------
CREATE OR REPLACE FUNCTION public.create_family(
  p_name text,
  p_tag text,
  p_description text DEFAULT NULL::text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_family public.families;
  my_family_id uuid;
  my_cash bigint;
  my_diamonds int;
  used_diamonds boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id, cash, diamonds INTO my_family_id, my_cash, my_diamonds
  FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_IN_FAMILY'; END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_NAME';
  END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN
    RAISE EXCEPTION 'FAMILY_NAME_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN
    RAISE EXCEPTION 'FAMILY_TAG_TAKEN';
  END IF;

  -- Dead players can't start families.
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  -- Cost: 2,000,000 cash OR 200 diamonds (server-side deduction).
  IF my_cash >= 2000000 THEN
    UPDATE public.players SET cash = cash - 2000000 WHERE id = auth.uid();
  ELSIF my_diamonds >= 200 THEN
    UPDATE public.players SET diamonds = diamonds - 200 WHERE id = auth.uid();
    used_diamonds := true;
  ELSE
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS_FOR_FAMILY: Need 2,000,000 cash or 200 diamonds';
  END IF;

  INSERT INTO public.families (name, tag, description)
  VALUES (trim(p_name), upper(trim(p_tag)), p_description)
  RETURNING * INTO new_family;

  INSERT INTO public.family_members (family_id, player_id, role)
  VALUES (new_family.id, auth.uid(), 'boss');

  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'family', to_jsonb(new_family),
    'used_diamonds', used_diamonds
  );
END;
$$;

-- ---------- 4) Defense-in-depth: revoke anon from all functions ----------
-- Functions still enforce auth inside their bodies; this just closes
-- the grant-layer surface so anonymous users cannot invoke any RPC
-- without going through the runtime checks.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;