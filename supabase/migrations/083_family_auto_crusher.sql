-- 083: Family Auto Crusher
--
-- Straight from the Bulletstar reference screenshot (Layouts Updates/
-- "Metal factory Systeem.jpg"), which is a family profile showing:
--     Crusher: Auto Crusher type: Klein / Maximum autos: 500
--              Kogels/auto: 8 / Autos omgezet: 16
-- i.e. a family-owned crusher with a tier, a lifetime car cap, a bullets-per-
-- car rate, and a running total of cars converted.
--
-- Also answers the bug-inspectie line "all factory's needs a limit cap of
-- bullets they hold" — the personal bullet factory got its 25k cap in 070;
-- this gives the family armoury one too.
--
-- How it differs from the personal junkyard (which pays YOU 15 bullets):
-- the crusher pays the FAMILY. A member feeding cars in is contributing, not
-- earning — leadership hands bullets back out. Higher tiers beat the junkyard
-- per car, so a well-run family out-produces a lone wolf.

alter table public.families
  add column if not exists crusher_tier int not null default 0 check (crusher_tier between 0 and 3),
  add column if not exists crusher_cars int not null default 0 check (crusher_cars >= 0),
  add column if not exists bullets bigint not null default 0 check (bullets >= 0);

-- Tier stats. Tier 0 = no crusher; buy one to start.
--   1 Klein   8/car   cap   500 cars   armoury 10k
--   2 Middel 12/car   cap 1,500 cars   armoury 25k
--   3 Groot  16/car   cap 5,000 cars   armoury 50k
create or replace function public._crusher_stats(p_tier int)
returns jsonb language sql immutable as $$
  select case p_tier
    when 1 then jsonb_build_object('name','Klein',  'per_car',8,  'max_cars',500,  'armoury',10000, 'upgrade_cost',2000000)
    when 2 then jsonb_build_object('name','Middel', 'per_car',12, 'max_cars',1500, 'armoury',25000, 'upgrade_cost',6000000)
    when 3 then jsonb_build_object('name','Groot',  'per_car',16, 'max_cars',5000, 'armoury',50000, 'upgrade_cost',null)
    else        jsonb_build_object('name',null,     'per_car',0,  'max_cars',0,    'armoury',0,     'upgrade_cost',2000000)
  end;
$$;

revoke all on function public._crusher_stats(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- feed a car in
-- ---------------------------------------------------------------------------

create or replace function public.family_crush_car(p_car_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  fam     public.families;
  car     public.player_cars;
  st      jsonb;
  v_gain  int;
  v_new   bigint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.family_id is null then raise exception 'NOT_IN_FAMILY'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into fam from public.families where id = p.family_id for update;
  if fam.crusher_tier = 0 then raise exception 'NO_CRUSHER'; end if;

  st := public._crusher_stats(fam.crusher_tier);

  if fam.crusher_cars >= (st->>'max_cars')::int then raise exception 'CRUSHER_WORN_OUT'; end if;

  select * into car from public.player_cars
   where id = p_car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_FOUND'; end if;
  -- Can't feed in a car that's escrowed on the auction block (082).
  if public._car_locked(car.id) then raise exception 'CAR_ON_AUCTION'; end if;

  v_gain := (st->>'per_car')::int;
  -- The armoury has a ceiling: overflow is scrap, not free storage.
  v_new := least((st->>'armoury')::bigint, fam.bullets + v_gain);
  v_gain := (v_new - fam.bullets)::int;

  if v_gain <= 0 then raise exception 'ARMOURY_FULL'; end if;

  delete from public.player_cars where id = car.id;

  update public.families
     set bullets = v_new,
         crusher_cars = crusher_cars + 1
   where id = fam.id;

  perform public._log_event_named(
    p.username, 'crusher',
    'fed a ' || car.model || ' to the family crusher (+' || v_gain || ' bullets)'
  );

  return jsonb_build_object(
    'success', true, 'car', car.model, 'bullets_gained', v_gain,
    'family_bullets', v_new, 'cars_crushed', fam.crusher_cars + 1,
    'max_cars', (st->>'max_cars')::int
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- buy / upgrade the crusher (leadership, family bank)
-- ---------------------------------------------------------------------------

create or replace function public.family_upgrade_crusher()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p      public.players;
  fam    public.families;
  v_role text;
  v_cost bigint;
  v_next int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid();
  if p.family_id is null then raise exception 'NOT_IN_FAMILY'; end if;

  select role into v_role from public.family_members
   where family_id = p.family_id and player_id = p.id;
  if v_role not in ('boss','underboss','accountant') then raise exception 'NOT_AUTHORIZED'; end if;

  select * into fam from public.families where id = p.family_id for update;

  v_next := fam.crusher_tier + 1;
  if v_next > 3 then raise exception 'MAX_TIER'; end if;

  v_cost := (public._crusher_stats(fam.crusher_tier)->>'upgrade_cost')::bigint;
  if fam.bank < v_cost then raise exception 'NOT_ENOUGH_BANK'; end if;

  update public.families
     set bank = bank - v_cost,
         crusher_tier = v_next,
         -- A new machine starts fresh; the old one's wear doesn't carry over.
         crusher_cars = 0
   where id = fam.id;

  perform public._log_event_named(
    p.username, 'crusher',
    'installed a ' || (public._crusher_stats(v_next)->>'name') || ' Auto Crusher for the family'
  );

  return jsonb_build_object(
    'success', true, 'tier', v_next,
    'name', public._crusher_stats(v_next)->>'name',
    'cost', v_cost
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- hand bullets out (leadership)
-- ---------------------------------------------------------------------------

create or replace function public.family_give_bullets(p_username text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p       public.players;
  fam     public.families;
  v_role  text;
  v_target public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid();
  if p.family_id is null then raise exception 'NOT_IN_FAMILY'; end if;

  select role into v_role from public.family_members
   where family_id = p.family_id and player_id = p.id;
  if v_role not in ('boss','underboss','accountant') then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_target from public.players where username ilike p_username;
  if v_target.id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  -- The armoury supplies the crew, not outsiders.
  if v_target.family_id is distinct from p.family_id then raise exception 'NOT_A_MEMBER'; end if;

  select * into fam from public.families where id = p.family_id for update;
  if fam.bullets < p_amount then raise exception 'NOT_ENOUGH_BULLETS'; end if;

  update public.families set bullets = bullets - p_amount where id = fam.id;
  update public.players set bullets = coalesce(bullets, 0) + p_amount where id = v_target.id;

  insert into public.messages (to_player_id, from_player_id, subject, body)
  values (
    v_target.id, null,
    'Armoury delivery',
    coalesce(p.username, 'Leadership') || ' sent you ' || p_amount || ' bullets from the family armoury.'
  );

  return jsonb_build_object(
    'success', true, 'to', v_target.username, 'amount', p_amount,
    'family_bullets', fam.bullets - p_amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- read
-- ---------------------------------------------------------------------------

create or replace function public.get_family_crusher()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  p      public.players;
  fam    public.families;
  st     jsonb;
  v_role text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid();
  if p.family_id is null then return jsonb_build_object('in_family', false); end if;

  select * into fam from public.families where id = p.family_id;
  select role into v_role from public.family_members
   where family_id = p.family_id and player_id = p.id;

  st := public._crusher_stats(fam.crusher_tier);

  return jsonb_build_object(
    'in_family', true,
    'family_name', fam.name,
    'my_role', v_role,
    'can_manage', v_role in ('boss','underboss','accountant'),
    'tier', fam.crusher_tier,
    'type_name', st->>'name',
    'per_car', (st->>'per_car')::int,
    'max_cars', (st->>'max_cars')::int,
    'cars_crushed', fam.crusher_cars,
    'armoury_cap', (st->>'armoury')::bigint,
    'bullets', fam.bullets,
    'upgrade_cost', (st->>'upgrade_cost')::bigint,
    'next_name', case when fam.crusher_tier < 3
                      then public._crusher_stats(fam.crusher_tier + 1)->>'name' end,
    'family_bank', fam.bank,
    'my_cars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.model, 'condition', c.condition,
        'value', c.base_value + case when c.tuned then 2000 else 0 end + c.parts_value_bonus
      ) order by c.created_at)
      from public.player_cars c
      where c.player_id = p.id and not public._car_locked(c.id)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('username', pl.username) order by pl.username)
      from public.family_members fm
      join public.players pl on pl.id = fm.player_id
      where fm.family_id = fam.id and pl.id <> p.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.family_crush_car(uuid) from public, anon;
revoke all on function public.family_upgrade_crusher() from public, anon;
revoke all on function public.family_give_bullets(text, int) from public, anon;
revoke all on function public.get_family_crusher() from public, anon;
-- (note: `revoke ... to public` is a syntax error — it's always `from`)

grant execute on function public.family_crush_car(uuid) to authenticated;
grant execute on function public.family_upgrade_crusher() to authenticated;
grant execute on function public.family_give_bullets(text, int) to authenticated;
grant execute on function public.get_family_crusher() to authenticated;
