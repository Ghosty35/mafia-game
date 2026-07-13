-- ============================================================
-- 016: Heat / Police, expanded Jail + Breakout, Heists groundwork
-- Fase 5.2 / 5.4
-- ============================================================

-- 1) Add heat to players (starts at 0, goes up with risky activity)
alter table public.players
  add column if not exists heat int not null default 0;

-- 2) Heists table (similar to crimes but bigger risk/reward + crew)
create table if not exists public.heists (
  key text primary key,
  min_level int not null default 5,
  min_crew int not null default 2,
  min_reward int not null,
  max_reward int not null,
  base_success numeric not null,
  xp int not null,
  jail_seconds int not null default 600,
  cooldown_seconds int not null default 10800,  -- 3 hours base
  sort_order int not null default 0
);

alter table public.heists enable row level security;

create policy "Logged in can view heists"
  on public.heists for select to authenticated using (true);

insert into public.heists (key, min_level, min_crew, min_reward, max_reward, base_success, xp, jail_seconds, cooldown_seconds, sort_order)
values
  ('convenience_store_raid', 5, 2, 800, 2200, 0.65, 60, 480, 7200, 1),   -- 2h cd
  ('armored_truck', 12, 3, 3500, 8500, 0.42, 180, 1800, 21600, 2),       -- 6h cd
  ('casino_vault', 22, 4, 12000, 28000, 0.28, 450, 5400, 86400, 3);      -- 24h cd

-- 3) Player heist cooldowns (reuse pattern)
create table if not exists public.heist_cooldowns (
  player_id uuid not null references public.players (id) on delete cascade,
  heist_key text not null references public.heists (key) on delete cascade,
  available_at timestamptz not null,
  primary key (player_id, heist_key)
);

alter table public.heist_cooldowns enable row level security;

create policy "Players view own heist cooldowns"
  on public.heist_cooldowns for select using (auth.uid() = player_id);

-- 4) Simple gear for heists (bought in armory/shop, gives bonus)
-- For MVP we use a jsonb column on player for owned gear bonuses
alter table public.players
  add column if not exists heist_gear jsonb not null default '{}'::jsonb;

-- Example gear: { "pistol": 8, "vest": 5, "c4": 15 }  = % bonus to success

-- 5) Update commit_crime to include heat gain + police chance
-- (This is an extension of the cooldown version from 005)
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
  heat_gain int;
  police_roll numeric;
  extra_jail int := 0;
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

  -- Jail check
  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;

  if p.level < c.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  -- Cooldown check
  select available_at into existing_cd 
  from public.crime_cooldowns 
  where player_id = p.id and crime_key = c.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

  -- Rebirth bonuses
  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  -- Roll
  succeeded := random() < c.success_chance;

  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
    heat_gain := 3;  -- low heat on success
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;
    p.jailed_until := now() + make_interval(secs => c.jail_seconds);
    heat_gain := 12; -- high heat on fail
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Police chance based on heat (Fase 5.4)
  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600); -- 5-15 min extra
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;

  -- Level up
  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    leveled_up := true;
    xp_needed := p.level * 100;
  end loop;

  -- Set cooldown
  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key) do update set available_at = excluded.available_at;

  update public.players
  set
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    jailed_until = p.jailed_until,
    heat = p.heat,
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

-- 6) Basic breakout function (pay to reduce jail)
create or replace function public.breakout()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  cost bigint;
  reduction int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.jailed_until is null or p.jailed_until <= now() then
    raise exception 'NOT_IN_JAIL';
  end if;

  cost := 500 + (extract(epoch from (p.jailed_until - now())) / 60 * 25)::bigint; -- rough cost
  if p.cash < cost then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  reduction := floor(extract(epoch from (p.jailed_until - now())) * 0.6); -- reduce by 60%
  p.cash := p.cash - cost;
  p.jailed_until := p.jailed_until - make_interval(secs => reduction);
  p.heat := greatest(0, p.heat - 15);

  update public.players set cash = p.cash, jailed_until = p.jailed_until, heat = p.heat where id = p.id;

  return jsonb_build_object('player', to_jsonb(p), 'reduced_seconds', reduction);
end;
$$;

-- 7) Simple heat decay over time (callable or via get_my_player later)
-- For now players can reduce heat slowly by doing low-risk things or time.

comment on column public.players.heat is 'Police attention. High heat = random jail on crimes.';
comment on function public.breakout() is 'Pay to break out of jail early. Reduces heat.';