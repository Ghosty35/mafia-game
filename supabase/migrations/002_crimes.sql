-- ============================================================
-- FASE 4: Crimes, jail and the core game loop
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Crime configuration. Balance lives here, not in code —
-- tweak numbers any time without touching the app.
create table public.crimes (
  key text primary key,
  min_level int not null default 1,
  energy_cost int not null,
  min_reward int not null,
  max_reward int not null,
  success_chance numeric not null check (success_chance > 0 and success_chance <= 1),
  xp_success int not null,
  jail_seconds int not null default 0,
  sort_order int not null default 0
);

alter table public.crimes enable row level security;

create policy "Logged in players can view crimes"
  on public.crimes
  for select
  to authenticated
  using (true);

insert into public.crimes
  (key, min_level, energy_cost, min_reward, max_reward, success_chance, xp_success, jail_seconds, sort_order)
values
  ('pickpocket', 1,  5,  20,   60,   0.90, 5,   30,  1),
  ('rob_store',  3,  15, 80,   250,  0.70, 15,  60,  2),
  ('steal_car',  6,  30, 300,  800,  0.50, 40,  120, 3),
  ('bank_heist', 10, 60, 1500, 5000, 0.25, 120, 300, 4);

-- 2) New player columns: jail status + crime statistics
alter table public.players
  add column jailed_until timestamptz,
  add column crimes_succeeded int not null default 0,
  add column crimes_failed int not null default 0;

-- 3) THE core game function. Everything happens server-side:
-- energy check, dice roll, reward, jail, level-ups.
create or replace function public.commit_crime(crime_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  c public.crimes;
  regen int;
  succeeded boolean;
  reward bigint := 0;
  gained_xp int := 0;
  leveled_up boolean := false;
  xp_needed bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into c from public.crimes where key = crime_key;
  if c.key is null then
    raise exception 'UNKNOWN_CRIME';
  end if;

  -- Lock the player row: blocks cheating via many requests at once
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

  -- Apply idle energy regen first (1 per minute, same rule as get_my_player)
  regen := floor(extract(epoch from (now() - p.energy_updated_at)) / 60);
  if regen > 0 and p.energy < p.max_energy then
    if p.energy + regen >= p.max_energy then
      p.energy := p.max_energy;
      p.energy_updated_at := now();
    else
      p.energy := p.energy + regen;
      p.energy_updated_at := p.energy_updated_at + make_interval(secs => regen * 60);
    end if;
  end if;

  -- The rules
  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;
  if p.level < c.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;
  if p.energy < c.energy_cost then
    raise exception 'NOT_ENOUGH_ENERGY';
  end if;

  p.energy := p.energy - c.energy_cost;

  -- The dice roll (server-side, cannot be manipulated)
  succeeded := random() < c.success_chance;

  if succeeded then
    reward := (c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1)))::bigint;
    gained_xp := c.xp_success;
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
  else
    -- Failed: half XP as consolation, straight to jail
    gained_xp := ceil(c.xp_success / 2.0);
    p.jailed_until := now() + make_interval(secs => c.jail_seconds);
    p.crimes_failed := p.crimes_failed + 1;
  end if;

  p.xp := p.xp + gained_xp;

  -- Level-ups: +5 max energy and a full energy refill as reward
  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    p.max_energy := p.max_energy + 5;
    p.energy := p.max_energy;
    p.energy_updated_at := now();
    leveled_up := true;
    xp_needed := p.level * 100;
  end loop;

  update public.players
  set
    cash = p.cash,
    energy = p.energy,
    max_energy = p.max_energy,
    level = p.level,
    xp = p.xp,
    energy_updated_at = p.energy_updated_at,
    jailed_until = p.jailed_until,
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'player', to_jsonb(p)
  );
end;
$$;
