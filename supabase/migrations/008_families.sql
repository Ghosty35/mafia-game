-- ============================================================
-- FAMILIES (replacing old "Gangs" concept)
-- Classic mafia Families (Five Families style).
-- Each player can join one Family.
-- Families compete on the Families Leaderboard.
-- ============================================================

-- 1) Families table
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tag text not null unique check (length(tag) between 2 and 5),
  description text,
  respect bigint not null default 0,
  territory integer not null default 0,
  wars_won integer not null default 0,
  member_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2) Link players to families (one family per player)
alter table public.players
  add column family_id uuid references public.families(id) on delete set null;

-- 3) Family membership history / roles (optional but powerful)
create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null default 'soldier', -- boss, underboss, caporegime, soldier, associate
  joined_at timestamptz not null default now(),
  primary key (family_id, player_id)
);

-- 4) Basic RLS (players can see families, but only manage their own membership via functions)
alter table public.families enable row level security;
alter table public.family_members enable row level security;

create policy "Families are publicly readable"
  on public.families for select using (true);

create policy "Players can view family memberships"
  on public.family_members for select using (true);

-- Note: All writes (create family, join, leave, promote) will go through SECURITY DEFINER functions later.

-- 5) Function to get Families Leaderboard (current season / all time)
create or replace function public.get_families_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'top', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'pos', pos,
          'id', id,
          'name', name,
          'tag', tag,
          'respect', respect,
          'territory', territory,
          'wars_won', wars_won,
          'member_count', member_count
        )
        order by pos
      ),
      '[]'::jsonb
    )
  )
  from (
    select 
      *,
      row_number() over (order by respect desc, territory desc, wars_won desc, member_count desc, created_at asc) as pos
    from public.families
    order by respect desc, territory desc, wars_won desc, member_count desc, created_at asc
    limit 50
  ) ranked;
$$;

-- 6) Helper: Update family member_count automatically (simple trigger for now)
create or replace function public.update_family_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.families set member_count = member_count + 1 where id = new.family_id;
  elsif tg_op = 'DELETE' then
    update public.families set member_count = member_count - 1 where id = old.family_id;
  end if;
  return null;
end;
$$;

create trigger family_member_count_trigger
after insert or delete on public.family_members
for each row execute function public.update_family_member_count();

-- 7) (Future) Season support note:
-- For real seasons we can later add season_id columns or snapshot tables.
-- For now this is "current season" (all accumulated respect/territory).
