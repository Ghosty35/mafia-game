-- ============================================================
-- FASE 3: Player stats table + anti-cheat setup
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) The players table. One row per registered user.
create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  cash bigint not null default 500,
  energy int not null default 100,
  max_energy int not null default 100,
  level int not null default 1,
  xp bigint not null default 0,
  -- used to calculate idle energy regeneration
  energy_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 2) ANTI-CHEAT: lock the table down.
-- Row Level Security ON, and players may only READ their own row.
-- There are NO insert/update/delete policies on purpose:
-- browsers can never write stats directly. All changes go through
-- server-side functions below.
alter table public.players enable row level security;

create policy "Players can view own profile"
  on public.players
  for select
  using ((select auth.uid()) = id);

-- 3) Auto-create a player row whenever someone registers.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.players (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

-- 4) Create player rows for accounts that already exist.
insert into public.players (id)
select id from auth.users
on conflict (id) do nothing;

-- 5) Read your own stats WITH idle energy regeneration.
-- Energy regenerates 1 point per minute, up to max_energy.
-- Calculated on the server from timestamps, so players cannot
-- speed it up by changing their PC clock or browser code.
create or replace function public.get_my_player()
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  regen int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into p from public.players where id = auth.uid();

  if p.id is null then
    insert into public.players (id) values (auth.uid()) returning * into p;
  end if;

  regen := floor(extract(epoch from (now() - p.energy_updated_at)) / 60);

  if regen > 0 and p.energy < p.max_energy then
    update public.players
    set
      energy = least(max_energy, energy + regen),
      -- keep leftover seconds so no regen time is ever lost
      energy_updated_at = case
        when energy + regen >= max_energy then now()
        else energy_updated_at + make_interval(secs => regen * 60)
      end
    where id = p.id
    returning * into p;
  end if;

  return p;
end;
$$;
