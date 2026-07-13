-- ============================================================
-- ENERGY -> COOLDOWNS + DIAMONDS GROUNDWORK
-- Removes the energy system. Each crime gets its own cooldown
-- timer instead (Bulletstar style). Adds the diamond currency.
-- Rebirth perk: -10% cooldowns per rebirth (max -50%).
-- RUN ORDER: 003 -> 004 -> 005 (this one)
-- ============================================================

-- 1) Premium currency groundwork (shop comes later)
alter table public.players
  add column diamonds bigint not null default 0;

-- 2) Crimes: replace energy cost with a cooldown
alter table public.crimes
  add column cooldown_seconds int not null default 30;

update public.crimes set cooldown_seconds = 20  where key = 'pickpocket';
update public.crimes set cooldown_seconds = 60  where key = 'rob_store';
update public.crimes set cooldown_seconds = 180 where key = 'steal_car';
update public.crimes set cooldown_seconds = 900 where key = 'bank_heist';

alter table public.crimes
  drop column energy_cost;

-- 3) Per-player, per-crime cooldown timers
create table public.crime_cooldowns (
  player_id uuid not null references public.players (id) on delete cascade,
  crime_key text not null references public.crimes (key) on delete cascade,
  available_at timestamptz not null,
  primary key (player_id, crime_key)
);

alter table public.crime_cooldowns enable row level security;

create policy "Players can view own cooldowns"
  on public.crime_cooldowns
  for select
  using ((select auth.uid()) = player_id);

-- 4) Remove energy from players
alter table public.players
  drop column energy,
  drop column max_energy,
  drop column energy_updated_at;

-- 5) get_my_player: much simpler without energy regen
create or replace function public.get_my_player()
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into p from public.players where id = auth.uid();

  if p.id is null then
    insert into public.players (id) values (auth.uid()) returning * into p;
  end if;

  return p;
end;
$$;

-- 6) rebirth: no energy anymore; also wipes cooldowns as a bonus
create or replace function public.rebirth()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

  -- 46 = Godfather (keep in sync with lib/ranks.ts)
  if p.level < 46 then
    raise exception 'NOT_GODFATHER';
  end if;

  delete from public.crime_cooldowns where player_id = p.id;

  update public.players
  set
    rebirths = rebirths + 1,
    level = 1,
    xp = 0,
    jailed_until = null
  where id = p.id
  returning * into p;

  return to_jsonb(p);
end;
$$;

-- 7) commit_crime: cooldowns replace energy.
-- VIP bonus: +50% cash/XP per rebirth AND -10% cooldown per
-- rebirth (capped at -50%).
create or replace function public.commit_crime(crime_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  p public.players;
  c public.crimes;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  succeeded boolean;
  mult numeric;
  reward bigint := 0;
  gained_xp int := 0;
  leveled_up boolean := false;
  xp_needed bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into c from public.crimes where key = commit_crime.crime_key;
  if c.key is null then
    raise exception 'UNKNOWN_CRIME';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;
  if p.level < c.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  select cc.available_at into existing_cd
  from public.crime_cooldowns cc
  where cc.player_id = p.id and cc.crime_key = c.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

  -- VIP rebirth bonuses
  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := 1 - least(p.rebirths * 0.10, 0.50);

  succeeded := random() < c.success_chance;

  if succeeded then
    reward := floor((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult)::int;
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
  else
    gained_xp := floor(ceil(c.xp_success / 2.0) * mult)::int;
    p.jailed_until := now() + make_interval(secs => c.jail_seconds);
    p.crimes_failed := p.crimes_failed + 1;
  end if;

  p.xp := p.xp + gained_xp;

  xp_needed := public.xp_needed_for_level(p.level);
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    leveled_up := true;
    xp_needed := public.xp_needed_for_level(p.level);
  end loop;

  -- Start this crime's cooldown
  next_available := now() + make_interval(secs => round(c.cooldown_seconds * cooldown_mult));

  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key)
  do update set available_at = excluded.available_at;

  update public.players
  set
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    jailed_until = p.jailed_until,
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'available_at', next_available,
    'player', to_jsonb(p)
  );
end;
$$;
