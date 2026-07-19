-- 139_travel_smuggling.sql
-- Travel smuggling / police risk (Layouts "Travel" note): carrying drugs when you
-- travel risks a bust — police on car/train, customs on the plane. The car is the
-- SAFEST smuggling route (lowest base risk) so it stays worth the fuel; train is
-- riskier, the plane riskiest. You may bribe (pay a fee) — but the bribe itself can
-- fail, and then you're busted anyway and out the money. A bust clears ALL drugs on
-- hand + adds heat. Clean (drug-free) trips are unaffected.
--
-- Also RESTORES train hardening that had drifted off the live travel_to_city
-- (jail/death gate, city whitelist via _city_km, the 3-min cooldown from 075, and
-- the _arrive event roll) — the live version had lost all of it to an out-of-band
-- overwrite, which is why the page's cooldown UI was dead.

-- Live-tunable knobs (seed only; _cfg falls back to these defaults regardless).
insert into public.game_config (key, num, label) values
  ('smuggle_bust_car',    8,  'Smuggle bust % base — car'),
  ('smuggle_bust_train',  15, 'Smuggle bust % base — train'),
  ('smuggle_bust_plane',  25, 'Smuggle bust % base — plane'),
  ('smuggle_bribe_success', 65, 'Smuggle bribe success %'),
  ('smuggle_bust_heat',   15, 'Heat added on a smuggling bust')
on conflict (key) do nothing;

-- ============================================================
-- _smuggle_check: evaluate + resolve the risk for one trip.
-- Caller must already hold the player row FOR UPDATE.
-- ============================================================
create or replace function public._smuggle_check(p_id uuid, p_mode text, p_bribe boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ds     jsonb;
  v_cash   bigint;
  v_kg     numeric;
  v_base   int;
  v_chance numeric;
  v_fee    bigint;
  v_heat   int;
  v_ok     boolean;
begin
  select drug_storage, cash into v_ds, v_cash from public.players where id = p_id;

  select coalesce(sum(value::numeric), 0) into v_kg
  from jsonb_each_text(coalesce(v_ds, '{}'::jsonb)) as e(key, value);

  if v_kg <= 0 then
    return jsonb_build_object('carried', 0, 'busted', false, 'bribed', false);
  end if;

  v_base := case p_mode
    when 'car'   then public._cfg('smuggle_bust_car', 8)::int
    when 'train' then public._cfg('smuggle_bust_train', 15)::int
    when 'plane' then public._cfg('smuggle_bust_plane', 25)::int
    else 15
  end;
  -- More product on you = more attention. +1pp per 5kg, capped +20pp, hard cap 90%.
  v_chance := least(90, v_base + least(20, floor(v_kg / 5)));
  v_heat := public._cfg('smuggle_bust_heat', 15)::int;

  if p_bribe then
    v_fee := least(100000, 10000 + (v_kg * 1000)::bigint);
    if v_cash < v_fee then raise exception 'NOT_ENOUGH_CASH_BRIBE'; end if;
    update public.players set cash = cash - v_fee where id = p_id;

    v_ok := random() < (public._cfg('smuggle_bribe_success', 65) / 100.0);
    if v_ok then
      return jsonb_build_object('carried', v_kg, 'busted', false, 'bribed', true,
        'bribe_fee', v_fee, 'bribe_success', true, 'chance', round(v_chance));
    end if;
    -- Bribe fell through: busted anyway, and the fee is gone.
    update public.players set drug_storage = '{}'::jsonb,
      heat = least(100, coalesce(heat, 0) + v_heat), heat_updated_at = now() where id = p_id;
    return jsonb_build_object('carried', v_kg, 'busted', true, 'bribed', true,
      'bribe_fee', v_fee, 'bribe_success', false, 'lost_kg', v_kg, 'chance', round(v_chance));
  end if;

  if random() < (v_chance / 100.0) then
    update public.players set drug_storage = '{}'::jsonb,
      heat = least(100, coalesce(heat, 0) + v_heat), heat_updated_at = now() where id = p_id;
    return jsonb_build_object('carried', v_kg, 'busted', true, 'bribed', false,
      'lost_kg', v_kg, 'chance', round(v_chance));
  end if;

  return jsonb_build_object('carried', v_kg, 'busted', false, 'bribed', false, 'chance', round(v_chance));
end;
$$;

revoke all on function public._smuggle_check(uuid, text, boolean) from public, anon, authenticated;

-- ============================================================
-- travel_to_city (train): hardened + smuggling
-- ============================================================
-- Drop old signatures first — adding a defaulted param would otherwise create a
-- second overload and make the calls ambiguous.
drop function if exists public.travel_to_city(text);
drop function if exists public.travel_by_car(text, uuid);
drop function if exists public.travel_by_plane(text);

create or replace function public.travel_to_city(city text, p_bribe boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  p public.players;
  cost bigint := 380;
  v_km int;
  v_smuggle jsonb;
  v_event jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF public.is_banned(p.id) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(p.id) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.current_city = city THEN RAISE EXCEPTION 'ALREADY_THERE'; END IF;

  v_km := public._city_km(p.current_city, city);
  IF v_km IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CITY'; END IF;

  IF p.travel_cooldown IS NOT NULL AND p.travel_cooldown > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - cost, travel_cooldown = now() + interval '3 minutes'
  WHERE id = p.id;

  v_smuggle := public._smuggle_check(p.id, 'train', p_bribe);
  v_event := public._arrive(p.id, city);

  RETURN jsonb_build_object('success', true, 'mode', 'train', 'city', city,
    'cost', cost, 'km', v_km, 'smuggle', v_smuggle, 'event', v_event);
END;
$$;

-- ============================================================
-- travel_by_car: + smuggling (lowest base risk)
-- ============================================================
create or replace function public.travel_by_car(p_city text, p_car_id uuid, p_bribe boolean default false)
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
  v_smuggle jsonb;
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

  v_smuggle := public._smuggle_check(p.id, 'car', p_bribe);
  v_event := public._arrive(p.id, p_city);

  return jsonb_build_object(
    'success', true, 'mode', 'car', 'city', p_city,
    'km', v_km, 'litres_used', v_need, 'wear', v_wear,
    'fuel_left', car.fuel - v_need, 'smuggle', v_smuggle, 'event', v_event
  );
end;
$$;

-- ============================================================
-- travel_by_plane: + smuggling (customs, highest base risk)
-- ============================================================
create or replace function public.travel_by_plane(p_city text, p_bribe boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  v_km    int;
  v_cost  bigint;
  v_smuggle jsonb;
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

  v_cost := greatest(500, round(v_km * 0.8)::bigint);
  if p.cash < v_cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - v_cost where id = p.id;

  v_smuggle := public._smuggle_check(p.id, 'plane', p_bribe);
  v_event := public._arrive(p.id, p_city);

  return jsonb_build_object(
    'success', true, 'mode', 'plane', 'city', p_city,
    'km', v_km, 'cost', v_cost, 'smuggle', v_smuggle, 'event', v_event
  );
end;
$$;

revoke all on function public.travel_to_city(text, boolean) from public, anon;
grant execute on function public.travel_to_city(text, boolean) to authenticated;
revoke all on function public.travel_by_car(text, uuid, boolean) from public, anon;
grant execute on function public.travel_by_car(text, uuid, boolean) to authenticated;
revoke all on function public.travel_by_plane(text, boolean) from public, anon;
grant execute on function public.travel_by_plane(text, boolean) to authenticated;
