-- ============================================================
-- 039: Fix missing infrastructure
--
-- Root cause: migrations 016, 021, 035, 036 and 037 were written
-- but several pieces were never actually run against the live
-- database (016's heists/heist_cooldowns tables + heist_gear
-- column, 021's buy_power, and all of 035/036/037). The app code
-- already calls the RPCs and reads the tables/columns these define,
-- so large parts of the game (heists, jail breakout, armory,
-- rebirth, admin panel, safehouse, real estate, travel, metal
-- factory, profile, races, territories, language switcher) were
-- failing at runtime with "relation/column does not exist" or
-- "function does not exist" errors.
--
-- Also fixes a bug present in the original 034/035 migrations:
-- both reference a players.breakout_skill column that is never
-- declared anywhere. It is added below.
--
-- This migration is idempotent (safe to re-run).
-- ============================================================

-- ---------- 1) Heists table + seed data (from 016 + 021) ----------
create table if not exists public.heists (
  key text primary key,
  min_level int not null default 5,
  min_crew int not null default 2,
  min_reward int not null,
  max_reward int not null,
  base_success numeric not null,
  xp int not null,
  jail_seconds int not null default 600,
  cooldown_seconds int not null default 10800,
  sort_order int not null default 0
);

alter table public.heists enable row level security;

drop policy if exists "Logged in can view heists" on public.heists;
create policy "Logged in can view heists"
  on public.heists for select to authenticated using (true);

insert into public.heists (key, min_level, min_crew, min_reward, max_reward, base_success, xp, jail_seconds, cooldown_seconds, sort_order)
values
  ('convenience_store_raid', 5, 2, 800, 2200, 0.65, 60, 480, 7200, 1),
  ('armored_truck', 12, 3, 3500, 8500, 0.42, 180, 1800, 21600, 2),
  ('casino_vault', 22, 4, 12000, 28000, 0.28, 450, 5400, 86400, 3)
on conflict (key) do nothing;

update public.heists set cooldown_seconds = 5400, min_crew = 2;

insert into public.heists (key, min_level, min_crew, min_reward, max_reward, base_success, xp, jail_seconds, cooldown_seconds, sort_order)
values ('warehouse_heist', 10, 2, 1500, 5000, 0.25, 120, 1800, 5400, 3)
on conflict (key) do update set
  cooldown_seconds = 5400,
  min_crew = 2;

-- ---------- 2) Heist cooldowns table (from 016) ----------
create table if not exists public.heist_cooldowns (
  player_id uuid not null references public.players (id) on delete cascade,
  heist_key text not null references public.heists (key) on delete cascade,
  available_at timestamptz not null,
  primary key (player_id, heist_key)
);

alter table public.heist_cooldowns enable row level security;

drop policy if exists "Players view own heist cooldowns" on public.heist_cooldowns;
create policy "Players view own heist cooldowns"
  on public.heist_cooldowns for select using (auth.uid() = player_id);

-- ---------- 3) Player columns referenced by already-live functions ----------
-- heist_gear: used by commit_heist (live) and update_my_state/apply_action (035)
-- breakout_skill: used by rebirth() (live, from 034) and apply_action/attempt_breakout (035)
--   -- this column was never declared in any prior migration; that's the bug.
alter table public.players
  add column if not exists heist_gear jsonb not null default '{}'::jsonb,
  add column if not exists breakout_skill numeric not null default 10;

-- ---------- 4) Basic breakout function (from 016; no later version exists) ----------
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

  cost := 500 + (extract(epoch from (p.jailed_until - now())) / 60 * 25)::bigint;
  if p.cash < cost then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  reduction := floor(extract(epoch from (p.jailed_until - now())) * 0.6);
  p.cash := p.cash - cost;
  p.jailed_until := p.jailed_until - make_interval(secs => reduction);
  p.heat := greatest(0, p.heat - 15);

  update public.players set cash = p.cash, jailed_until = p.jailed_until, heat = p.heat where id = p.id;

  return jsonb_build_object('player', to_jsonb(p), 'reduced_seconds', reduction);
end;
$$;

comment on function public.breakout() is 'Pay to break out of jail early. Reduces heat.';

-- ---------- 5) Armory: buy_power (from 021) ----------
create or replace function public.buy_power(power_amount int, cost bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  p.cash := p.cash - cost;
  p.power := p.power + power_amount;

  update public.players set cash = p.cash, power = p.power where id = p.id;
  return jsonb_build_object('player', to_jsonb(p));
end;
$$;
