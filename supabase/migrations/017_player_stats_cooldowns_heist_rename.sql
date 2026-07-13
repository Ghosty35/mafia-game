-- ============================================================
-- 017: Player stats (Health, Murder Skill, Power), Cooldown tuning, 
--      Bank Heist rename to Warehouse Heist, new Train Murder Skill crime
-- ============================================================

-- 1) Add new player stats columns
alter table public.players
  add column if not exists health int not null default 100,
  add column if not exists murder_skill numeric not null default 0,
  add column if not exists power int not null default 0;

-- 2) Update existing crimes cooldowns (in seconds)
update public.crimes set cooldown_seconds = 180  where key = 'pickpocket';   -- 3 min
update public.crimes set cooldown_seconds = 300  where key = 'rob_store';     -- 5 min
update public.crimes set cooldown_seconds = 420  where key = 'steal_car';     -- 7 min

-- 3) Rename Bank Heist to Warehouse Heist + new cooldown
update public.crimes 
set key = 'warehouse_heist', 
    cooldown_seconds = 1800   -- 30 min
where key = 'bank_heist';

-- If the old bank_heist row doesn't exist (because of previous renames), insert it
insert into public.crimes (key, min_level, min_reward, max_reward, success_chance, xp_success, jail_seconds, cooldown_seconds, sort_order)
values ('warehouse_heist', 10, 1500, 5000, 0.25, 120, 300, 1800, 4)
on conflict (key) do update set cooldown_seconds = 1800;

-- 4) New crime: Train Your MurderSkill (for PvP / murder system)
insert into public.crimes (key, min_level, min_reward, max_reward, success_chance, xp_success, jail_seconds, cooldown_seconds, sort_order)
values ('train_murder', 8, 50, 150, 0.45, 10, 300, 600, 5)  -- 10 min cooldown, 5 min jail on fail
on conflict (key) do nothing;

-- 5) Extend commit_crime to handle new stats + special murder training logic
-- This builds on previous version. Run after previous heat/jail migration.
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
  murder_gain numeric := 0;
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

  -- Roll success
  succeeded := random() < c.success_chance;

  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    -- Special logic for Murder Training
    if c.key = 'train_murder' then
      murder_gain := 0.02;
      p.murder_skill := p.murder_skill + murder_gain;
      heat_gain := 15; -- risky training
    else
      heat_gain := 3;
    end if;
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;

    if c.key = 'train_murder' then
      -- Special fail for murder training: 5 min jail
      p.jailed_until := now() + make_interval(secs => 300);
      heat_gain := 25;
    else
      p.jailed_until := now() + make_interval(secs => c.jail_seconds);
      heat_gain := 12;
    end if;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Police chance (from previous)
  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;

  -- Level ups (basic, no energy anymore)
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

  -- Update player with new stats
  update public.players
  set
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    jailed_until = p.jailed_until,
    heat = p.heat,
    murder_skill = p.murder_skill,
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'available_at', next_available,
    'murder_skill_gained', murder_gain,
    'player', to_jsonb(p)
  );
end;
$$;

-- 6) Make sure get_my_player returns the new columns (it should with SELECT *)
-- If you have a custom get_my_player, make sure it selects * or the new fields.

comment on column public.players.murder_skill is 'KillSkill / Murder experience. +0.02 per successful training.';
comment on column public.players.power is 'Total player power (can be increased via weapon shop purchases).';
comment on column public.players.health is 'Player health (currently always 100%).';