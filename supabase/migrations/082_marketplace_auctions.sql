-- 082: Real car auctions
--
-- Bug-inspectie: "Marketplace can use a better UI Design" + "car market place
-- ^ Categories". The UI was rebuilt in Phase 3 but the data was still
-- DEMO_LISTINGS in the page — bids never touched money and nothing was ever
-- actually sold. This is the market underneath it.
--
-- Cars only for now: they're the one asset with a real ownership row
-- (player_cars) that can change hands. Properties live in a jsonb blob on
-- players and would need their own migration to trade safely.
--
-- Money rules:
--   * Bidding ESCROWS the cash immediately. Being outbid refunds you in full.
--     No bidding money you don't have, and no "winner can't pay" at settle.
--   * The car is escrowed too: listing locks it out of selling, crushing,
--     tuning, racing and driving until the auction ends.
--   * The house takes 5% of the sale, into gov_tax_bank — a real money sink
--     that also feeds the Tax Bank leaderboard (078).
--   * Selling a car is legitimate income, so proceeds are CLEAN cash (066).
--
-- Settlement is lazy on read, like heat decay and war resolution — no cron.

-- ---------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------

create table if not exists public.auctions (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.players(id) on delete cascade,
  car_id         uuid not null references public.player_cars(id) on delete cascade,
  title          text not null,
  start_price    bigint not null check (start_price >= 100),
  buy_now        bigint check (buy_now is null or buy_now > 0),
  current_bid    bigint,
  current_bidder uuid references public.players(id) on delete set null,
  ends_at        timestamptz not null,
  status         text not null default 'live'
                   check (status in ('live','sold','expired','cancelled')),
  settled_at     timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.auction_bids (
  id         uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id  uuid not null references public.players(id) on delete cascade,
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.auctions enable row level security;
alter table public.auction_bids enable row level security;
-- RPC-only: reads go through get_auctions so we can settle on the way past.

-- A car can only be in one live auction.
create unique index if not exists auctions_one_live_per_car
  on public.auctions (car_id) where status = 'live';

create index if not exists auctions_board on public.auctions (status, ends_at);
create index if not exists auctions_seller on public.auctions (seller_id, status);
create index if not exists auction_bids_lookup on public.auction_bids (auction_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------

-- Garage capacity by property tier — mirrors garage_buy_car's rule so the two
-- can't drift apart.
create or replace function public._max_cars(p_player uuid)
returns int
language plpgsql
stable
security definer
set search_path to ''
as $$
declare p public.players;
begin
  select * into p from public.players where id = p_player;
  if p.id is null then return 0; end if;
  return case
    when public._count_owned_ptype(p.owned_properties, 'mansion') > 0 then 8 + coalesce(p.garage_level,0) * 10
    when public._count_owned_ptype(p.owned_properties, 'villa')   > 0 then 4 + coalesce(p.garage_level,0) * 4
    when public._count_owned_ptype(p.owned_properties, 'house')   > 0 then 2
    else 0
  end;
end;
$$;

/** True while a car is escrowed in a live auction. */
create or replace function public._car_locked(p_car_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.auctions
    where car_id = p_car_id and status = 'live'
  );
$$;

revoke all on function public._max_cars(uuid) from public, anon, authenticated;
revoke all on function public._car_locked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. settlement (lazy)
-- ---------------------------------------------------------------------------

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
begin
  for a in
    select * from public.auctions
     where status = 'live' and ends_at <= now()
     for update skip locked
  loop
    if a.current_bidder is null then
      -- Nobody wanted it: the car simply comes off the block.
      update public.auctions set status = 'expired', settled_at = now() where id = a.id;
      continue;
    end if;

    -- The winner still needs somewhere to put it. If their garage filled up
    -- since they bid, refund them rather than losing the car into limbo.
    v_space := public._max_cars(a.current_bidder);
    select count(*) into v_have from public.player_cars where player_id = a.current_bidder;

    if v_have >= v_space then
      update public.players set cash = cash + a.current_bid where id = a.current_bidder;
      update public.auctions set status = 'expired', settled_at = now() where id = a.id;
      continue;
    end if;

    v_fee := floor(a.current_bid * 0.05)::bigint;
    v_net := a.current_bid - v_fee;

    -- Car changes hands; the bidder's cash was already escrowed at bid time.
    update public.player_cars set player_id = a.current_bidder where id = a.car_id;

    -- Seller banks the net (clean — selling a car is legitimate income) and is
    -- credited with the house cut as tax paid, which feeds the Tax Bank board.
    update public.players
       set cash = cash + v_net,
           gov_tax_bank = coalesce(gov_tax_bank, 0) + v_fee
     where id = a.seller_id;

    update public.auctions set status = 'sold', settled_at = now() where id = a.id;

    select username into v_seller from public.players where id = a.seller_id;
    select username into v_buyer  from public.players where id = a.current_bidder;

    insert into public.messages (to_player_id, from_player_id, subject, body)
    values (
      a.seller_id, null,
      'Auction sold: ' || a.title,
      coalesce(v_buyer, 'A buyer') || ' won your ' || a.title || ' for $' || a.current_bid ||
      '. After the 5% house cut you received $' || v_net || '.'
    );

    insert into public.messages (to_player_id, from_player_id, subject, body)
    values (
      a.current_bidder, null,
      'Auction won: ' || a.title,
      'You won the ' || a.title || ' from ' || coalesce(v_seller, 'a seller') ||
      ' for $' || a.current_bid || '. It''s in your garage.'
    );
  end loop;
end;
$$;

revoke all on function public._settle_auctions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. listing
-- ---------------------------------------------------------------------------

create or replace function public.auction_list_car(
  p_car_id uuid,
  p_start_price bigint,
  p_buy_now bigint default null,
  p_hours int default 6
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p     public.players;
  car   public.player_cars;
  v_id  uuid;
  v_live int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_start_price < 100 then raise exception 'PRICE_TOO_LOW'; end if;
  if p_buy_now is not null and p_buy_now <= p_start_price then raise exception 'BUYNOW_TOO_LOW'; end if;
  if p_hours not in (1, 3, 6, 12, 24) then raise exception 'INVALID_DURATION'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into car from public.player_cars
   where id = p_car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_FOUND'; end if;

  if public._car_locked(p_car_id) then raise exception 'CAR_ALREADY_LISTED'; end if;

  -- Three at a time keeps the board from being one player's garage.
  select count(*) into v_live from public.auctions
   where seller_id = p.id and status = 'live';
  if v_live >= 3 then raise exception 'TOO_MANY_LISTINGS'; end if;

  insert into public.auctions (seller_id, car_id, title, start_price, buy_now, ends_at)
  values (p.id, car.id, car.model, p_start_price, p_buy_now, now() + make_interval(hours => p_hours))
  returning id into v_id;

  return jsonb_build_object(
    'success', true, 'auction_id', v_id,
    'title', car.model, 'ends_at', now() + make_interval(hours => p_hours)
  );
end;
$$;

create or replace function public.auction_cancel(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare a public.auctions;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null then raise exception 'AUCTION_NOT_FOUND'; end if;
  if a.seller_id <> auth.uid() then raise exception 'NOT_YOUR_AUCTION'; end if;
  if a.status <> 'live' then raise exception 'AUCTION_OVER'; end if;
  -- Pulling a car out from under a real bidder isn't on.
  if a.current_bidder is not null then raise exception 'HAS_BIDS'; end if;

  update public.auctions set status = 'cancelled', settled_at = now() where id = a.id;
  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. bidding (real escrow)
-- ---------------------------------------------------------------------------

create or replace function public.auction_bid(p_auction_id uuid, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p     public.players;
  a     public.auctions;
  v_min bigint;
  v_space int;
  v_have  int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  perform public._settle_auctions();

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null then raise exception 'AUCTION_NOT_FOUND'; end if;
  if a.status <> 'live' then raise exception 'AUCTION_OVER'; end if;
  if a.ends_at <= now() then raise exception 'AUCTION_OVER'; end if;
  if a.seller_id = p.id then raise exception 'CANNOT_BID_OWN'; end if;
  if a.current_bidder = p.id then raise exception 'ALREADY_HIGH_BIDDER'; end if;

  -- Don't let someone win a car they have nowhere to keep.
  v_space := public._max_cars(p.id);
  select count(*) into v_have from public.player_cars where player_id = p.id;
  if v_have >= v_space then raise exception 'GARAGE_FULL'; end if;

  -- First bid meets the start price; after that it's +5% or +100, whichever is more.
  v_min := case
    when a.current_bid is null then a.start_price
    else a.current_bid + greatest(100, floor(a.current_bid * 0.05)::bigint)
  end;
  if p_amount < v_min then raise exception 'BID_TOO_LOW'; end if;
  if p.cash < p_amount then raise exception 'NOT_ENOUGH_CASH'; end if;

  -- Escrow: take the new bid, hand the old one back.
  update public.players set cash = cash - p_amount where id = p.id;
  if a.current_bidder is not null then
    update public.players set cash = cash + a.current_bid where id = a.current_bidder;
  end if;

  update public.auctions
     set current_bid = p_amount,
         current_bidder = p.id,
         -- Anti-snipe: a late bid pushes the close out to two minutes.
         ends_at = greatest(ends_at, now() + interval '2 minutes')
   where id = a.id;

  insert into public.auction_bids (auction_id, bidder_id, amount)
  values (a.id, p.id, p_amount);

  return jsonb_build_object(
    'success', true, 'bid', p_amount,
    'min_next', p_amount + greatest(100, floor(p_amount * 0.05)::bigint),
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

create or replace function public.auction_buy_now(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p     public.players;
  a     public.auctions;
  v_space int;
  v_have  int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  perform public._settle_auctions();

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null then raise exception 'AUCTION_NOT_FOUND'; end if;
  if a.status <> 'live' then raise exception 'AUCTION_OVER'; end if;
  if a.buy_now is null then raise exception 'NO_BUY_NOW'; end if;
  if a.seller_id = p.id then raise exception 'CANNOT_BID_OWN'; end if;
  if a.current_bid is not null and a.current_bid >= a.buy_now then raise exception 'BIDDING_PASSED_BUYNOW'; end if;
  if p.cash < a.buy_now then raise exception 'NOT_ENOUGH_CASH'; end if;

  v_space := public._max_cars(p.id);
  select count(*) into v_have from public.player_cars where player_id = p.id;
  if v_have >= v_space then raise exception 'GARAGE_FULL'; end if;

  -- Take the money, refund whoever was leading, then settle immediately.
  update public.players set cash = cash - a.buy_now where id = p.id;
  if a.current_bidder is not null then
    update public.players set cash = cash + a.current_bid where id = a.current_bidder;
  end if;

  update public.auctions
     set current_bid = a.buy_now, current_bidder = p.id, ends_at = now()
   where id = a.id;

  insert into public.auction_bids (auction_id, bidder_id, amount) values (a.id, p.id, a.buy_now);

  perform public._settle_auctions();

  return jsonb_build_object(
    'success', true, 'paid', a.buy_now,
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. board
-- ---------------------------------------------------------------------------

create or replace function public.get_auctions()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Reading the board is what closes finished auctions.
  perform public._settle_auctions();

  return jsonb_build_object(
    'me', v_me,
    'my_cash', (select cash from public.players where id = v_me),
    'live', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
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
        'condition', c.condition,
        'tuned', c.tuned,
        'speed_bonus', c.speed_bonus,
        'value', c.base_value + case when c.tuned then 2000 else 0 end + c.parts_value_bonus
      ) order by a.ends_at)
      from public.auctions a
      join public.players s on s.id = a.seller_id
      left join public.players b on b.id = a.current_bidder
      join public.player_cars c on c.id = a.car_id
      where a.status = 'live'
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
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

-- Cars you can put up: yours, and not already on the block.
create or replace function public.get_listable_cars()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.model,
      'condition', c.condition,
      'tuned', c.tuned,
      'value', c.base_value + case when c.tuned then 2000 else 0 end + c.parts_value_bonus
    ) order by c.created_at)
    from public.player_cars c
    where c.player_id = auth.uid()
      and not public._car_locked(c.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.auction_list_car(uuid, bigint, bigint, int) from public, anon;
revoke all on function public.auction_cancel(uuid) from public, anon;
revoke all on function public.auction_bid(uuid, bigint) from public, anon;
revoke all on function public.auction_buy_now(uuid) from public, anon;
revoke all on function public.get_auctions() from public, anon;
revoke all on function public.get_listable_cars() from public, anon;

grant execute on function public.auction_list_car(uuid, bigint, bigint, int) to authenticated;
grant execute on function public.auction_cancel(uuid) to authenticated;
grant execute on function public.auction_bid(uuid, bigint) to authenticated;
grant execute on function public.auction_buy_now(uuid) to authenticated;
grant execute on function public.get_auctions() to authenticated;
grant execute on function public.get_listable_cars() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. enforce the escrow
--
-- Listing a car has to actually hold it. Without this, a seller could crush or
-- sell a car that was live on the block (both DELETE the row) and settlement
-- would hand the winner a car that no longer exists — or hand back nothing
-- while keeping their escrowed cash. Tuning/parts/driving are blocked too so
-- what bidders see is what they get.
-- ---------------------------------------------------------------------------

create or replace function public.garage_sell_car(p_car_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare p public.players; pc public.player_cars; sale int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into pc from public.player_cars where id = p_car_id and player_id = auth.uid() for update;
  if not found then raise exception 'CAR_NOT_FOUND'; end if;
  if public._car_locked(pc.id) then raise exception 'CAR_ON_AUCTION'; end if;
  sale := floor(public._car_value(pc) * pc.condition / 100.0)::int;
  select * into p from public.players where id = auth.uid() for update;
  update public.players set cash = cash + sale where id = p.id;
  delete from public.player_cars where id = pc.id;
  return jsonb_build_object('success', true, 'sale', sale, 'new_cash', p.cash + sale);
end;
$$;

create or replace function public.garage_crush_car(p_car_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare p public.players; pc public.player_cars; c_bullets constant int := 15;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into pc from public.player_cars where id = p_car_id and player_id = auth.uid() for update;
  if not found then raise exception 'CAR_NOT_FOUND'; end if;
  if public._car_locked(pc.id) then raise exception 'CAR_ON_AUCTION'; end if;
  update public.players set bullets = coalesce(bullets,0) + c_bullets where id = auth.uid() returning * into p;
  delete from public.player_cars where id = pc.id;
  return jsonb_build_object('success', true, 'bullets_gained', c_bullets, 'bullets', p.bullets);
end;
$$;

create or replace function public.garage_tune_car(p_car_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare p public.players; pc public.player_cars; c_cost constant int := 2000;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into pc from public.player_cars where id = p_car_id and player_id = auth.uid() for update;
  if not found then raise exception 'CAR_NOT_FOUND'; end if;
  if public._car_locked(pc.id) then raise exception 'CAR_ON_AUCTION'; end if;
  if pc.condition < 100 then raise exception 'TUNE_NEEDS_REPAIR'; end if;
  if pc.tuned then raise exception 'ALREADY_TUNED'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.cash < c_cost then raise exception 'NOT_ENOUGH_CASH'; end if;
  update public.players set cash = cash - c_cost where id = p.id;
  update public.player_cars set tuned = true where id = pc.id;
  return jsonb_build_object('success', true, 'cost', c_cost, 'new_cash', p.cash - c_cost);
end;
$$;

create or replace function public.garage_buy_part(p_car_id uuid, p_part_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare p public.players; pc public.player_cars; cost int; bonus int; mod_name text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  case p_part_id
    when 'engine'  then cost := 2500; bonus := 5; mod_name := 'Engine Upgrade';
    when 'turbo'   then cost := 4000; bonus := 8; mod_name := 'Turbo Kit';
    when 'brakes'  then cost := 1500; bonus := 3; mod_name := 'Brakes & Suspension';
    when 'bodykit' then cost := 1200; bonus := 2; mod_name := 'Bodykit';
    else raise exception 'UNKNOWN_PART';
  end case;
  select * into pc from public.player_cars where id = p_car_id and player_id = auth.uid() for update;
  if not found then raise exception 'CAR_NOT_FOUND'; end if;
  if public._car_locked(pc.id) then raise exception 'CAR_ON_AUCTION'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;
  update public.players set cash = cash - cost where id = p.id;
  update public.player_cars set
    speed_bonus       = least(50, speed_bonus + bonus),
    parts_value_bonus = parts_value_bonus + (cost / 2),
    mods              = mods || to_jsonb(mod_name)
  where id = pc.id;
  return jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
end;
$$;

-- Driving a listed car would burn its fuel and condition out from under bidders.
create or replace function public.travel_by_car(p_city text, p_car_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  car     public.player_cars;
  v_km    int;
  v_need  int;
  v_wear  int;
  v_event jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;
  if p.current_city = p_city then raise exception 'ALREADY_THERE'; end if;

  v_km := public._city_km(p.current_city, p_city);
  if v_km is null then raise exception 'UNKNOWN_CITY'; end if;

  select * into car from public.player_cars
  where id = p_car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_FOUND'; end if;
  if public._car_locked(car.id) then raise exception 'CAR_ON_AUCTION'; end if;
  if car.condition < 25 then raise exception 'CAR_TOO_DAMAGED'; end if;

  v_need := public._trip_litres(v_km);
  if car.fuel < v_need then raise exception 'NOT_ENOUGH_FUEL'; end if;

  v_wear := greatest(1, round(v_km / 500.0)::int);

  update public.player_cars
  set fuel = fuel - v_need,
      condition = greatest(0, condition - v_wear)
  where id = car.id;

  v_event := public._arrive(p.id, p_city);

  return jsonb_build_object(
    'success', true, 'mode', 'car', 'city', p_city,
    'km', v_km, 'litres_used', v_need, 'wear', v_wear,
    'fuel_left', car.fuel - v_need, 'event', v_event
  );
end;
$$;
