-- ============================================================
-- REBIRTH (prestige) SYSTEM
-- Godfather (level 46) can rebirth: reset to level 1, keep cash,
-- gain a permanent stacking +50% cash & XP bonus + VIP status.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Track rebirths per player
alter table public.players
  add column rebirths int not null default 0;

-- 2) The rebirth function (server-side, cannot be faked)
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

  update public.players
  set
    rebirths = rebirths + 1,
    level = 1,
    xp = 0,
    max_energy = 100,
    energy = 100,
    energy_updated_at = now(),
    jailed_until = null
  where id = p.id
  returning * into p;

  return to_jsonb(p);
end;
$$;

-- 3) commit_crime now applies the rebirth bonus:
-- multiplier = 1 + (0.5 * rebirths) on both cash and XP
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
  mult numeric;
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

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

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

  -- VIP rebirth bonus
  mult := 1 + (p.rebirths * 0.5);

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
    p.max_energy := p.max_energy + 5;
    p.energy := p.max_energy;
    p.energy_updated_at := now();
    leveled_up := true;
    xp_needed := public.xp_needed_for_level(p.level);
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
