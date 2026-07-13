-- 023: Death system, Kill protection, Cities, Bullets, basic property groundwork

alter table public.players
  add column if not exists current_city text not null default 'New York',
  add column if not exists death_until timestamptz,
  add column if not exists kill_protected_until timestamptz,
  add column if not exists bullets bigint not null default 0;

-- Basic properties table for purchasable locations (train stations, factories, etc.)
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  type text not null,           -- 'train_station', 'metal_factory', 'detective_agency', 'hospital', 'general_bank'
  city text not null,
  name text not null,
  owner_id uuid references public.players(id),
  income_per_hour bigint default 0,
  level int default 1,
  created_at timestamptz default now()
);

alter table public.properties enable row level security;

create policy "Players can view properties" on public.properties for select using (true);

-- Example properties (run once)
insert into public.properties (type, city, name, income_per_hour) values
('train_station', 'New York', 'Grand Central Station', 50),
('metal_factory', 'Chicago', 'Midwest Munitions', 120),
('detective_agency', 'Los Angeles', 'Shadow Investigations', 80),
('hospital', 'Miami', 'South Beach Medical', 90),
('general_bank', 'Las Vegas', 'Desert Vault Bank', 200)
on conflict do nothing;

-- Simple in-game messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  to_player_id uuid references public.players(id),
  from_player_id uuid references public.players(id),
  subject text,
  body text,
  read boolean default false,
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy "Players can view their messages" on public.messages 
  for select using (auth.uid() = to_player_id);

create policy "Players can send messages" on public.messages 
  for insert with check (auth.uid() = from_player_id);