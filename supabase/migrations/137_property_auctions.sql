-- 137_property_auctions.sql
-- Extend the 082 car-auction engine to PROPERTIES via JSONB-snapshot escrow
-- (user-approved approach). Properties live in players.owned_properties (a jsonb
-- blob), so instead of normalizing the whole income backbone we:
--   * pull the property OUT of the seller's blob at listing time and hold its JSON
--     on the auction row (real escrow — while listed it can't be collected/sold);
--   * on a sale, re-stamp it (accrued income CLEARED per user's choice: bank_balance
--     -> 0, last_earned/purchase_date -> now) and append it to the winner, enforcing
--     the same property caps as purchase_property (4 total / 1 mansion / 2 villa / 4 house);
--   * on expiry, no-bid, or a winner who can no longer hold it, RETURN the property to
--     the seller's blob (unlike cars, whose ownership row never left the seller).
-- Cash escrow, 5% house cut -> seller's gov_tax_bank (Tax Bank board), anti-snipe
-- +2min, and settle-on-read all reuse the existing car flow.

-- ============================================================
-- Schema: auctions can now hold a car OR a snapshotted property
-- ============================================================
alter table public.auctions alter column car_id drop not null;
alter table public.auctions
  add column if not exists item_type text not null default 'car',
  add column if not exists property_json jsonb;
alter table public.auctions
  drop constraint if exists auctions_item_type_check;
alter table public.auctions
  add constraint auctions_item_type_check check (item_type in ('car','property'));

-- ============================================================
-- Helper: can this player take on one more property?
-- Mirrors purchase_property's caps exactly (4 total / mansion 1 / villa 2 / house 4).
-- ============================================================
create or replace function public._can_hold_property(p_player uuid, p_prop jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_owned jsonb;
  v_ptype text;
begin
  select owned_properties into v_owned from public.players where id = p_player;
  v_owned := coalesce(v_owned, '[]'::jsonb);
  if jsonb_array_length(v_owned) >= 4 then return false; end if;
  v_ptype := lower(coalesce(p_prop->>'ptype', ''));
  if v_ptype = 'mansion' and public._count_owned_ptype(v_owned, 'mansion') >= 1 then return false; end if;
  if v_ptype = 'villa'   and public._count_owned_ptype(v_owned, 'villa')   >= 2 then return false; end if;
  if v_ptype = 'house'   and public._count_owned_ptype(v_owned, 'house')   >= 4 then return false; end if;
  return true;
end;
$$;

-- ============================================================
-- List a property for auction (pulls it from the seller's blob)
-- ============================================================
create or replace function public.auction_list_property(p_property_id text, p_start_price bigint, p_buy_now bigint default null, p_hours integer default 6)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  v_prop  jsonb;
  v_snap  jsonb;
  v_id    uuid;
  v_live  int;
  v_title text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_start_price < 100 then raise exception 'PRICE_TOO_LOW'; end if;
  if p_buy_now is not null and p_buy_now <= p_start_price then raise exception 'BUYNOW_TOO_LOW'; end if;
  if p_hours not in (1, 3, 6, 12, 24) then raise exception 'INVALID_DURATION'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  -- Grab the property from the blob (first match by id).
  select el into v_prop
  from jsonb_array_elements(coalesce(p.owned_properties, '[]'::jsonb)) el
  where el->>'id' = p_property_id
  limit 1;
  if v_prop is null then raise exception 'PROPERTY_NOT_FOUND'; end if;

  -- Three live listings at a time (shared with car listings).
  select count(*) into v_live from public.auctions where seller_id = p.id and status = 'live';
  if v_live >= 3 then raise exception 'TOO_MANY_LISTINGS'; end if;

  -- Snapshot with accrued income cleared (user's choice).
  v_snap := v_prop
    || jsonb_build_object('bank_balance', 0, 'earnings_week', 0, 'last_earned', now());

  v_title := coalesce(v_prop->>'name', 'Property')
    || ' (' || coalesce(v_prop->>'city', '?') || ')';

  -- Remove exactly one matching entry (lowest index) from the seller's blob (escrow).
  update public.players
  set owned_properties = (
    select coalesce(jsonb_agg(el order by ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(owned_properties, '[]'::jsonb)) with ordinality as t(el, ord)
    where ord <> (
      select min(ord2)
      from jsonb_array_elements(coalesce(owned_properties, '[]'::jsonb)) with ordinality as t2(el2, ord2)
      where el2->>'id' = p_property_id
    )
  )
  where id = p.id;

  insert into public.auctions (seller_id, car_id, item_type, property_json, title, start_price, buy_now, ends_at)
  values (p.id, null, 'property', v_snap, v_title, p_start_price, p_buy_now, now() + make_interval(hours => p_hours))
  returning id into v_id;

  return jsonb_build_object('success', true, 'auction_id', v_id, 'title', v_title, 'ends_at', now() + make_interval(hours => p_hours));
end;
$$;

revoke all on function public.auction_list_property(text, bigint, bigint, integer) from public, anon;
grant execute on function public.auction_list_property(text, bigint, bigint, integer) to authenticated;

-- ============================================================
-- get_listable_properties: the seller's own properties for the dropdown
-- ============================================================
create or replace function public.get_listable_properties()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', el->>'id',
      'name', coalesce(el->>'name', 'Property'),
      'city', coalesce(el->>'city', '?'),
      'income', coalesce((el->>'income')::bigint, (el->>'income_per_hour')::bigint, 0),
      'ptype', coalesce(el->>'ptype', el->>'type', '')
    ))
    from jsonb_array_elements((select owned_properties from public.players where id = v_me)) el
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_listable_properties() from public, anon;
grant execute on function public.get_listable_properties() to authenticated;

-- ============================================================
-- auction_bid: branch the "can you receive it" check by item type
-- ============================================================
create or replace function public.auction_bid(p_auction_id uuid, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_min bigint;
  v_space int;
  v_have  int;
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
  IF a.current_bidder IS NOT NULL THEN UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder; END IF;

  UPDATE public.auctions SET current_bid = p_amount, current_bidder = p.id, ends_at = greatest(ends_at, now() + interval '2 minutes') WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, p_amount);

  RETURN jsonb_build_object('success', true, 'bid', p_amount, 'min_next', p_amount + greatest(100, floor(p_amount * 0.05)::bigint), 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;

-- ============================================================
-- auction_buy_now: same branch
-- ============================================================
create or replace function public.auction_buy_now(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_space int;
  v_have  int;
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
  IF a.current_bidder IS NOT NULL THEN UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder; END IF;

  UPDATE public.auctions SET current_bid = a.buy_now, current_bidder = p.id, ends_at = now() WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, a.buy_now);
  PERFORM public._settle_auctions();

  RETURN jsonb_build_object('success', true, 'paid', a.buy_now, 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;

-- ============================================================
-- auction_cancel: for a property, return it to the seller's blob
-- ============================================================
create or replace function public.auction_cancel(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE a public.auctions; p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.seller_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOUR_AUCTION'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.current_bidder IS NOT NULL THEN RAISE EXCEPTION 'HAS_BIDS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  IF a.item_type = 'property' THEN
    UPDATE public.players
       SET owned_properties = coalesce(owned_properties, '[]'::jsonb)
         || jsonb_build_array(a.property_json || jsonb_build_object('last_earned', now()))
     WHERE id = a.seller_id;
  END IF;

  UPDATE public.auctions SET status = 'cancelled', settled_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- _settle_auctions: handle property terminal states
-- ============================================================
create or replace function public._settle_auctions()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  a        record;
  v_fee    bigint;
  v_net    bigint;
  v_space  int;
  v_have   int;
  v_seller text;
  v_buyer  text;
  v_snap   jsonb;
begin
  for a in
    select * from public.auctions
     where status = 'live' and ends_at <= now()
     for update skip locked
  loop
    -- ---------- PROPERTY auctions ----------
    if a.item_type = 'property' then
      if a.current_bidder is null then
        -- No buyer: hand the property back to the seller.
        update public.players
           set owned_properties = coalesce(owned_properties, '[]'::jsonb)
             || jsonb_build_array(a.property_json || jsonb_build_object('last_earned', now()))
         where id = a.seller_id;
        update public.auctions set status = 'expired', settled_at = now() where id = a.id;
        continue;
      end if;

      if not public._can_hold_property(a.current_bidder, a.property_json) then
        -- Winner filled up since bidding: refund them, return property to seller.
        update public.players set cash = cash + a.current_bid where id = a.current_bidder;
        update public.players
           set owned_properties = coalesce(owned_properties, '[]'::jsonb)
             || jsonb_build_array(a.property_json || jsonb_build_object('last_earned', now()))
         where id = a.seller_id;
        update public.auctions set status = 'expired', settled_at = now() where id = a.id;
        continue;
      end if;

      v_fee := floor(a.current_bid * 0.05)::bigint;
      v_net := a.current_bid - v_fee;

      -- Fresh clock for the winner (income starts accruing now, nothing owed).
      v_snap := a.property_json || jsonb_build_object(
        'bank_balance', 0, 'earnings_week', 0,
        'last_earned', now(), 'purchase_date', now()
      );
      update public.players
         set owned_properties = coalesce(owned_properties, '[]'::jsonb) || jsonb_build_array(v_snap)
       where id = a.current_bidder;

      update public.players
         set cash = cash + v_net,
             gov_tax_bank = coalesce(gov_tax_bank, 0) + v_fee
       where id = a.seller_id;

      update public.auctions set status = 'sold', settled_at = now() where id = a.id;

      select username into v_seller from public.players where id = a.seller_id;
      select username into v_buyer  from public.players where id = a.current_bidder;

      insert into public.messages (to_player_id, from_player_id, subject, body)
      values (a.seller_id, null, 'Auction sold: ' || a.title,
        coalesce(v_buyer, 'A buyer') || ' won your ' || a.title || ' for $' || a.current_bid ||
        '. After the 5% house cut you received $' || v_net || '.');
      insert into public.messages (to_player_id, from_player_id, subject, body)
      values (a.current_bidder, null, 'Auction won: ' || a.title,
        'You won ' || a.title || ' from ' || coalesce(v_seller, 'a seller') ||
        ' for $' || a.current_bid || '. It''s in your portfolio.');
      continue;
    end if;

    -- ---------- CAR auctions (unchanged) ----------
    if a.current_bidder is null then
      update public.auctions set status = 'expired', settled_at = now() where id = a.id;
      continue;
    end if;

    v_space := public._max_cars(a.current_bidder);
    select count(*) into v_have from public.player_cars where player_id = a.current_bidder;

    if v_have >= v_space then
      update public.players set cash = cash + a.current_bid where id = a.current_bidder;
      update public.auctions set status = 'expired', settled_at = now() where id = a.id;
      continue;
    end if;

    v_fee := floor(a.current_bid * 0.05)::bigint;
    v_net := a.current_bid - v_fee;

    update public.player_cars set player_id = a.current_bidder where id = a.car_id;

    update public.players
       set cash = cash + v_net,
           gov_tax_bank = coalesce(gov_tax_bank, 0) + v_fee
     where id = a.seller_id;

    update public.auctions set status = 'sold', settled_at = now() where id = a.id;

    select username into v_seller from public.players where id = a.seller_id;
    select username into v_buyer  from public.players where id = a.current_bidder;

    insert into public.messages (to_player_id, from_player_id, subject, body)
    values (a.seller_id, null, 'Auction sold: ' || a.title,
      coalesce(v_buyer, 'A buyer') || ' won your ' || a.title || ' for $' || a.current_bid ||
      '. After the 5% house cut you received $' || v_net || '.');
    insert into public.messages (to_player_id, from_player_id, subject, body)
    values (a.current_bidder, null, 'Auction won: ' || a.title,
      'You won the ' || a.title || ' from ' || coalesce(v_seller, 'a seller') ||
      ' for $' || a.current_bid || '. It''s in your garage.');
  end loop;
end;
$$;

-- ============================================================
-- get_auctions: left-join cars so property auctions appear too
-- ============================================================
create or replace function public.get_auctions()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  perform public._settle_auctions();

  return jsonb_build_object(
    'me', v_me,
    'my_cash', (select cash from public.players where id = v_me),
    'live', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'item_type', a.item_type,
        'title', a.title,
        'seller', s.username,
        'is_mine', a.seller_id = v_me,
        'start_price', a.start_price,
        'buy_now', a.buy_now,
        'current_bid', a.current_bid,
        'high_bidder', b.username,
        'im_high', a.current_bidder = v_me,
        'ends_at', a.ends_at,
        'bid_count', (select count(*) from public.auction_bids ab where ab.auction_id = a.id),
        'min_next', case
          when a.current_bid is null then a.start_price
          else a.current_bid + greatest(100, floor(a.current_bid * 0.05)::bigint)
        end,
        -- car-only fields (null for properties)
        'condition', c.condition,
        'tuned', c.tuned,
        'speed_bonus', c.speed_bonus,
        'value', c.base_value + case when c.tuned then 2000 else 0 end + c.parts_value_bonus,
        -- property-only fields (null for cars)
        'city', a.property_json->>'city',
        'income', coalesce((a.property_json->>'income')::bigint, (a.property_json->>'income_per_hour')::bigint),
        'prop_type', coalesce(a.property_json->>'ptype', a.property_json->>'type')
      ) order by a.ends_at)
      from public.auctions a
      join public.players s on s.id = a.seller_id
      left join public.players b on b.id = a.current_bidder
      left join public.player_cars c on c.id = a.car_id
      where a.status = 'live'
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_type', a.item_type,
        'title', a.title,
        'price', a.current_bid,
        'buyer', b.username,
        'seller', s.username,
        'settled_at', a.settled_at
      ) order by a.settled_at desc)
      from public.auctions a
      join public.players s on s.id = a.seller_id
      left join public.players b on b.id = a.current_bidder
      where a.status = 'sold' and a.settled_at > now() - interval '2 days'
      limit 10
    ), '[]'::jsonb)
  );
end;
$$;
