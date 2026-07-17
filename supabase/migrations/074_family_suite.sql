-- 074: Family suite backend (Phase 3 page redesigns)
--
-- 1. family_members.donated — cumulative per-member donation tracking,
--    incremented by donate_to_family. Powers the "your total donations"
--    counter on the new /families/donations page.
-- 2. get_family_profile(uuid) — public family card (creation date, boss,
--    members, owned cities) for the new /families/profile page.
-- 3. get_my_family() — now returns member player_id (the promote/kick UI
--    silently broke without it), level, joined_at, donated, plus
--    my_donated and the list of owned territory cities.
-- 4. get_public_profile() — adds family name/tag, created_at, last_active,
--    rebirths for the enriched /profile page.
-- 5. Drops the dead pending-donation flow: donate_to_family has paid the
--    family bank directly since it went live, nothing ever inserted into
--    family_pending_donations (0 rows), so the table and its two readers
--    are unreachable code.

-- 1. donation tracking ------------------------------------------------------
alter table public.family_members
  add column if not exists donated bigint not null default 0;

-- 2. donations bump the member's lifetime total ------------------------------
create or replace function public.donate_to_family(amount bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  my_family_id uuid;
  my_cash bigint;
  respect_gain bigint;
  my_total bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is null then
    raise exception 'NOT_IN_FAMILY';
  end if;

  select cash into my_cash from public.players where id = auth.uid() for update;
  if amount <= 0 or my_cash < amount then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  update public.players set cash = cash - amount where id = auth.uid();

  respect_gain := greatest(1, floor(amount / 10));

  update public.families
  set bank = bank + amount,
      respect = respect + respect_gain
  where id = my_family_id;

  update public.family_members
  set donated = donated + amount
  where family_id = my_family_id and player_id = auth.uid()
  returning donated into my_total;

  return jsonb_build_object(
    'success', true,
    'donated', amount,
    'my_total_donated', coalesce(my_total, amount),
    'new_bank', (select bank from public.families where id = my_family_id),
    'respect_gained', respect_gain
  );
end;
$$;

-- 3. public family profile ---------------------------------------------------
create or replace function public.get_family_profile(p_family_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  fam public.families;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into fam from public.families where id = p_family_id;
  if fam.id is null then
    raise exception 'FAMILY_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', fam.id,
    'name', fam.name,
    'tag', fam.tag,
    'description', fam.description,
    'created_at', fam.created_at,
    'respect', fam.respect,
    'power', fam.power,
    'wars_won', fam.wars_won,
    'member_count', fam.member_count,
    'boss', (
      select pl.username
      from public.family_members fm
      join public.players pl on pl.id = fm.player_id
      where fm.family_id = fam.id and fm.role = 'boss'
      limit 1
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'username', pl.username,
          'role', fm.role,
          'level', pl.level,
          'joined_at', fm.joined_at
        )
        order by
          case fm.role
            when 'boss' then 1
            when 'underboss' then 2
            when 'accountant' then 3
            when 'manager' then 4
            when 'caporegime' then 5
            when 'soldier' then 6
            else 7
          end, pl.username
      ), '[]'::jsonb)
      from public.family_members fm
      join public.players pl on pl.id = fm.player_id
      where fm.family_id = fam.id
    ),
    'territories', (
      select coalesce(jsonb_agg(t.city order by t.city), '[]'::jsonb)
      from public.territories t
      where t.owner_family_id = fam.id
    )
  );
end;
$$;

revoke all on function public.get_family_profile(uuid) from public, anon;
grant execute on function public.get_family_profile(uuid) to authenticated;

-- 4. richer get_my_family ------------------------------------------------------
create or replace function public.get_my_family()
returns jsonb
language plpgsql
security definer
set search_path to ''
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
    'my_donated', (
      select donated from public.family_members
      where family_id = fam.id and player_id = auth.uid()
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'player_id', fm.player_id,
          'username', pl.username,
          'role', fm.role,
          'level', pl.level,
          'joined_at', fm.joined_at,
          'donated', fm.donated
        )
        order by
          case fm.role
            when 'boss' then 1
            when 'underboss' then 2
            when 'accountant' then 3
            when 'manager' then 4
            when 'caporegime' then 5
            when 'soldier' then 6
            else 7
          end, pl.username
      ), '[]'::jsonb)
      from public.family_members fm
      join public.players pl on pl.id = fm.player_id
      where fm.family_id = fam.id
    ),
    'territories', (
      select coalesce(jsonb_agg(t.city order by t.city), '[]'::jsonb)
      from public.territories t
      where t.owner_family_id = fam.id
    )
  );
end;
$$;

-- 5. richer public player profile ---------------------------------------------
create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'level', p.level,
    'is_donator', p.is_donator,
    'crimes_succeeded', p.crimes_succeeded, 'crimes_failed', p.crimes_failed,
    'family_id', p.family_id, 'power', p.power, 'protection', p.protection,
    'health', p.health, 'murder_skill', p.murder_skill,
    'avatar_url', p.avatar_url, 'bio', p.bio,
    'created_at', p.created_at, 'last_active', p.last_active,
    'rebirths', p.rebirths,
    'family_name', f.name, 'family_tag', f.tag
  ) into result
  from public.players p
  left join public.families f on f.id = p.family_id
  where p.username ilike p_username
  limit 1;

  if result is null then raise exception 'PLAYER_NOT_FOUND'; end if;
  return result;
end;
$$;

-- 6. drop the dead pending-donation flow ---------------------------------------
drop function if exists public.accept_pending_donation(uuid);
drop function if exists public.get_family_pending_donations();
drop table if exists public.family_pending_donations;
