-- ============================================================
-- DEEPEN FAMILIES: Crimes now build Family Respect
-- This makes Families feel meaningful (core of the plan)
-- 
-- Every successful crime by a family member gives the Family Respect.
-- Families with active members grow stronger on the leaderboard.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Add a small family bonus for being in a family
--    (players in families earn slightly more cash from crimes)
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
  family_respect_gained bigint := 0;
  in_family boolean := false;
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

    -- === FAMILY RESPECT SYSTEM (NEW) ===
    -- If player is in a family, award respect to the family
    -- and give the player a small family loyalty bonus
    if p.family_id is not null then
      in_family := true;
      family_respect_gained := floor(reward * 0.18)::bigint;  -- ~18% of loot goes to family

      -- Small loyalty bonus for being in a family (mafia flavor)
      reward := floor(reward * 1.10)::bigint;  -- +10% cash when in a family

      -- Update family respect
      update public.families
      set respect = respect + family_respect_gained
      where id = p.family_id;
    end if;

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
    'player', to_jsonb(p),
    'family_respect_gained', family_respect_gained,
    'in_family', in_family
  );
end;
$$;

-- 2) Update get_my_family to also return current respect + territory for the UI
create or replace function public.get_my_family()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fam public.families;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select f.* into fam
  from public.families f
  join public.players p on p.family_id = f.id
  where p.id = auth.uid();

  if fam.id is null then
    return jsonb_build_object('family', null, 'my_role', null, 'members', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'family', to_jsonb(fam),
    'my_role', (
      select role from public.family_members 
      where family_id = fam.id and player_id = auth.uid()
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'username', pl.username,
          'role', fm.role
        )
        order by 
          case fm.role 
            when 'boss' then 1 
            when 'underboss' then 2 
            when 'caporegime' then 3 
            else 4 
          end, pl.username
      ), '[]'::jsonb)
      from public.family_members fm
      join public.players pl on pl.id = fm.player_id
      where fm.family_id = fam.id
      limit 20
    )
  );
end;
$$;

COMMENT ON FUNCTION public.commit_crime(text) IS 
'Core crime function. Now awards Family Respect (18% of loot) when player is in a family + small cash loyalty bonus. This makes being in a Family meaningful.';

-- 3) Optional: small helper to show family status on dashboard
create or replace function public.get_my_family_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'family_id', p.family_id,
    'family_name', f.name,
    'family_tag', f.tag,
    'family_respect', f.respect,
    'my_role', fm.role
  )
  from public.players p
  left join public.families f on f.id = p.family_id
  left join public.family_members fm on fm.family_id = p.family_id and fm.player_id = p.id
  where p.id = auth.uid();
$$;