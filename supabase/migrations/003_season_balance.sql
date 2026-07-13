-- ============================================================
-- SEASON REBALANCE: progression curve tuned for 3-6 month rounds
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) One shared XP formula: 30 * level^1.5
-- Starts fast (level 2 after ~6 pickpockets), stretches hard at
-- the top so a 3-month round stays interesting for hardcore players.
--   level  2:    30 XP     level 10:   ~949 XP
--   level 20: ~2,683 XP    level 30: ~4,930 XP  (per level!)
create or replace function public.xp_needed_for_level(lvl int)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select floor(30 * lvl * sqrt(lvl))::bigint
$$;

-- 2) commit_crime now uses the season curve
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

  succeeded := random() < c.success_chance;

  if succeeded then
    reward := (c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1)))::bigint;
    gained_xp := c.xp_success;
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
  else
    gained_xp := ceil(c.xp_success / 2.0);
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
