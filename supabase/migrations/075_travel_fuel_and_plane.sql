-- 075: Travel overhaul — train / car (fuel) / plane
--
-- Three ways to cross the country, each with a real trade-off:
--   TRAIN  $380 flat, but a 3 minute cooldown.        (budget)
--   CAR    fuel only, no cooldown, wears the car.     (freedom — needs a car)
--   PLANE  distance-priced cash, no cooldown.         (premium)
--
-- Fuel is litres in the tank (player_cars.fuel), burned at 50 km/L. Tank size
-- comes from car_catalog.fuel_tank, so cheap cars physically cannot cross the
-- country (NY->LA needs 79L) while a Mercedes (80L) just makes it. Refuel in
-- the garage at the CURRENT city's price — Vegas is cheap, New York is not.
-- Running dry simply blocks the trip (agreed design; no stranding).

-- ---------------------------------------------------------------------------
-- 1. reference data
-- ---------------------------------------------------------------------------

create table if not exists public.city_distances (
  from_city text not null,
  to_city   text not null,
  km        int  not null check (km > 0),
  primary key (from_city, to_city)
);

create table if not exists public.city_fuel_prices (
  city            text primary key,
  price_per_litre int not null check (price_per_litre > 0)
);

-- RPC-only reference data, same lockdown as car_catalog.
alter table public.city_distances    enable row level security;
alter table public.city_fuel_prices  enable row level security;

insert into public.city_fuel_prices (city, price_per_litre) values
  ('New York', 14), ('Chicago', 12), ('Los Angeles', 13), ('Miami', 11), ('Las Vegas', 10)
on conflict (city) do update set price_per_litre = excluded.price_per_litre;

-- Symmetric matrix, inserted once per direction.
insert into public.city_distances (from_city, to_city, km)
select a, b, km from (values
  ('New York','Chicago',1150), ('New York','Los Angeles',3940),
  ('New York','Miami',1750),   ('New York','Las Vegas',3570),
  ('Chicago','Los Angeles',2800), ('Chicago','Miami',1910),
  ('Chicago','Las Vegas',2560),
  ('Los Angeles','Miami',3760), ('Los Angeles','Las Vegas',430),
  ('Miami','Las Vegas',3350)
) as v(a,b,km)
on conflict do nothing;

insert into public.city_distances (from_city, to_city, km)
select to_city, from_city, km from public.city_distances
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. columns
-- ---------------------------------------------------------------------------

alter table public.car_catalog
  add column if not exists fuel_tank int not null default 50 check (fuel_tank > 0),
  add column if not exists min_level int not null default 1  check (min_level >= 1);

alter table public.player_cars
  add column if not exists fuel int not null default 0 check (fuel >= 0);

alter table public.players
  add column if not exists travel_cooldown timestamptz;

-- Tank size and level gate by tier. Cheap cars stay short-range on purpose.
update public.car_catalog set fuel_tank = 45, min_level = 1  where id = 'old_sedan';
update public.car_catalog set fuel_tank = 50, min_level = 1  where id in ('honda_civic','toyota_corolla','ford_focus','vw_golf');
update public.car_catalog set fuel_tank = 60, min_level = 5  where id = 'sports_car';
update public.car_catalog set fuel_tank = 70, min_level = 10 where id in ('nissan_altima','lexus_is');
update public.car_catalog set fuel_tank = 80, min_level = 12 where id = 'mercedes_c';

-- Existing cars start with a full tank (one-time gift, not a repeatable grant).
update public.player_cars pc
set fuel = cc.fuel_tank
from public.car_catalog cc
where pc.catalog_id = cc.id and pc.fuel = 0;

-- ---------------------------------------------------------------------------
-- 3. helpers
-- ---------------------------------------------------------------------------

-- 50 km per litre; a trip's fuel need is always at least 1L.
create or replace function public._trip_litres(p_km int)
returns int language sql immutable as $$
  select greatest(1, ceil(p_km / 50.0)::int);
$$;

create or replace function public._city_km(p_from text, p_to text)
returns int language sql stable security definer set search_path to '' as $$
  select km from public.city_distances where from_city = p_from and to_city = p_to;
$$;

-- Shared tail for every travel mode: move the player and roll the road event.
create or replace function public._arrive(p_id uuid, p_city text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  update public.players set current_city = p_city where id = p_id;
  return public._roll_random_event(p_id);
end;
$$;

revoke all on function public._trip_litres(int) from public, anon, authenticated;
revoke all on function public._city_km(text, text) from public, anon, authenticated;
revoke all on function public._arrive(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. travel: train (existing signature — 3 minute cooldown is new)
-- ---------------------------------------------------------------------------

create or replace function public.travel_to_city(city text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p public.players;
  cost bigint := 380;
  v_city text := city;   -- copy out of the parameter: it shadows column names below
  v_event jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.city_fuel_prices f where f.city = v_city) then
    raise exception 'UNKNOWN_CITY';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;
  if p.current_city = v_city then raise exception 'ALREADY_THERE'; end if;
  if p.travel_cooldown is not null and p.travel_cooldown > now() then raise exception 'ON_COOLDOWN'; end if;
  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players
  set cash = cash - cost,
      travel_cooldown = now() + interval '3 minutes'
  where id = p.id;

  v_event := public._arrive(p.id, v_city);

  return jsonb_build_object(
    'success', true, 'mode', 'train', 'city', v_city,
    'cost', cost, 'event', v_event
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. travel: car (burns fuel, wears the car, no cooldown)
-- ---------------------------------------------------------------------------

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

  -- Ownership is enforced by the where-clause, not trusted from the client.
  select * into car from public.player_cars
  where id = p_car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_FOUND'; end if;
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

-- ---------------------------------------------------------------------------
-- 6. travel: plane (premium, distance-priced, no cooldown)
-- ---------------------------------------------------------------------------

create or replace function public.travel_by_plane(p_city text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  v_km    int;
  v_cost  bigint;
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

  -- Floor keeps the short Vegas hop from undercutting the train.
  v_cost := greatest(500, round(v_km * 0.8)::bigint);
  if p.cash < v_cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - v_cost where id = p.id;

  v_event := public._arrive(p.id, p_city);

  return jsonb_build_object(
    'success', true, 'mode', 'plane', 'city', p_city,
    'km', v_km, 'cost', v_cost, 'event', v_event
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. refuel (garage) — price is the CURRENT city's, set server-side
-- ---------------------------------------------------------------------------

create or replace function public.garage_refuel_car(p_car_id uuid, p_litres int)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  car      public.player_cars;
  tank     int;
  v_price  int;
  v_add    int;
  v_cost   bigint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_litres is null or p_litres <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into car from public.player_cars
  where id = p_car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_FOUND'; end if;

  select fuel_tank into tank from public.car_catalog where id = car.catalog_id;
  tank := coalesce(tank, 50);

  -- Never sell more than fits: no paying for fuel that evaporates.
  v_add := least(p_litres, tank - car.fuel);
  if v_add <= 0 then raise exception 'TANK_FULL'; end if;

  select price_per_litre into v_price from public.city_fuel_prices where city = p.current_city;
  if v_price is null then raise exception 'UNKNOWN_CITY'; end if;

  v_cost := v_add::bigint * v_price;
  if p.cash < v_cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players   set cash = cash - v_cost where id = p.id;
  update public.player_cars set fuel = fuel + v_add where id = car.id;

  return jsonb_build_object(
    'success', true, 'litres', v_add, 'price_per_litre', v_price,
    'cost', v_cost, 'fuel', car.fuel + v_add, 'fuel_tank', tank
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. read models
-- ---------------------------------------------------------------------------

create or replace function public.get_travel_info()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  return jsonb_build_object(
    'current_city', p.current_city,
    'travel_cooldown', p.travel_cooldown,
    'train_cost', 380,
    'fuel_price', (select price_per_litre from public.city_fuel_prices where city = p.current_city),
    'destinations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'city', d.to_city,
        'km', d.km,
        'train_cost', 380,
        'plane_cost', greatest(500, round(d.km * 0.8)::bigint),
        'litres_needed', public._trip_litres(d.km)
      ) order by d.km), '[]'::jsonb)
      from public.city_distances d
      where d.from_city = p.current_city
    ),
    'cars', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pc.id,
        'name', pc.model,
        'condition', pc.condition,
        'fuel', pc.fuel,
        'fuel_tank', cc.fuel_tank,
        'range_km', pc.fuel * 50
      ) order by pc.created_at), '[]'::jsonb)
      from public.player_cars pc
      join public.car_catalog cc on cc.id = pc.catalog_id
      where pc.player_id = p.id
    )
  );
end;
$$;

-- Garage needs fuel/tank to render the pump.
create or replace function public.get_garage()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  result jsonb;
  lvl    int;
  v_city text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select garage_level, current_city into lvl, v_city from public.players where id = auth.uid();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',          pc.id,
      'catalog_id',  pc.catalog_id,
      'name',        pc.model,
      'condition',   pc.condition,
      'tuned',       pc.tuned,
      'speed_bonus', pc.speed_bonus,
      'mods',        pc.mods,
      'fuel',        pc.fuel,
      'fuel_tank',   coalesce(cc.fuel_tank, 50),
      'value',       pc.base_value + case when pc.tuned then 2000 else 0 end + pc.parts_value_bonus
    ) order by pc.created_at
  ), '[]'::jsonb)
  into result
  from public.player_cars pc
  left join public.car_catalog cc on cc.id = pc.catalog_id
  where pc.player_id = auth.uid();

  return jsonb_build_object(
    'cars',         result,
    'garage_level', coalesce(lvl, 0),
    'fuel_price',   (select f.price_per_litre from public.city_fuel_prices f where f.city = v_city)
  );
end;
$$;

create or replace function public.get_car_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'tier', tier,
    'base_value', base_value, 'base_speed', base_speed, 'purchase_price', purchase_price,
    'fuel_tank', fuel_tank, 'min_level', min_level
  ) order by purchase_price), '[]'::jsonb)
  into result from public.car_catalog;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. buying a car: enforce min_level, deliver it fuelled
-- ---------------------------------------------------------------------------

create or replace function public.garage_buy_car(p_catalog_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p public.players; cc public.car_catalog; new_id uuid;
  max_cars int; cur_cars int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into cc from public.car_catalog where id = p_catalog_id;
  if not found then raise exception 'UNKNOWN_CAR'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.level < cc.min_level then raise exception 'LEVEL_TOO_LOW'; end if;

  max_cars := case
    when public._count_owned_ptype(p.owned_properties, 'mansion') > 0 then 8 + coalesce(p.garage_level,0) * 10
    when public._count_owned_ptype(p.owned_properties, 'villa')   > 0 then 4 + coalesce(p.garage_level,0) * 4
    when public._count_owned_ptype(p.owned_properties, 'house')   > 0 then 2
    else 0
  end;
  select count(*) into cur_cars from public.player_cars where player_id = p.id;
  if cur_cars >= max_cars then raise exception 'GARAGE_FULL'; end if;
  if p.cash < cc.purchase_price then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - cc.purchase_price where id = p.id;
  insert into public.player_cars (player_id, catalog_id, model, base_value, fuel)
    values (p.id, cc.id, cc.name, cc.base_value, cc.fuel_tank) returning id into new_id;

  return jsonb_build_object('success', true, 'car_id', new_id, 'new_cash', p.cash - cc.purchase_price);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. cooldown board picks up the train timer
-- ---------------------------------------------------------------------------

create or replace function public.get_my_cooldowns()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  p public.players;
  result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid();
  if p.id is null then return result; end if;

  result := result
    || jsonb_build_object('key', 'murder',        'available_at', p.murder_cooldown)
    || jsonb_build_object('key', 'jail',          'available_at', p.jailed_until)
    || jsonb_build_object('key', 'death',         'available_at', p.death_until)
    || jsonb_build_object('key', 'travel',        'available_at', p.travel_cooldown)
    || jsonb_build_object('key', 'lottery',       'available_at',
         case when p.lottery_last_entry is not null then p.lottery_last_entry + interval '7 days' end)
    || jsonb_build_object('key', 'family_hourly', 'available_at',
         case when p.last_family_claim_at is not null then p.last_family_claim_at + interval '1 hour' end);

  result := result || coalesce((
    select jsonb_agg(jsonb_build_object('key', 'crime:' || crime_key, 'available_at', available_at))
    from public.crime_cooldowns where player_id = p.id
  ), '[]'::jsonb);

  result := result || coalesce((
    select jsonb_agg(jsonb_build_object('key', 'heist:' || heist_key, 'available_at', available_at))
    from public.heist_cooldowns where player_id = p.id
  ), '[]'::jsonb);

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. grants
-- ---------------------------------------------------------------------------

revoke all on function public.travel_by_car(text, uuid)   from public, anon;
revoke all on function public.travel_by_plane(text)        from public, anon;
revoke all on function public.garage_refuel_car(uuid, int) from public, anon;
revoke all on function public.get_travel_info()            from public, anon;

grant execute on function public.travel_by_car(text, uuid)   to authenticated;
grant execute on function public.travel_by_plane(text)        to authenticated;
grant execute on function public.garage_refuel_car(uuid, int) to authenticated;
grant execute on function public.get_travel_info()            to authenticated;
