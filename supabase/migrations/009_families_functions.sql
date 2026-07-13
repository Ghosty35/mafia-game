-- ============================================================
-- FAMILIES FUNCTIONS
-- Create, join, leave, and manage Families.
-- All writes go through these SECURITY DEFINER functions.
-- ============================================================

-- Helper: check if player is already in a family
create or replace function public.get_my_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id from public.players where id = auth.uid();
$$;

-- Create a new Family (player must not already be in one)
create or replace function public.create_family(
  p_name text,
  p_tag text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_family public.families;
  my_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Must have a username
  if not exists (select 1 from public.players where id = auth.uid() and username is not null) then
    raise exception 'NO_USERNAME';
  end if;

  -- Player cannot already be in a family
  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is not null then
    raise exception 'ALREADY_IN_FAMILY';
  end if;

  -- Validate inputs
  if p_name is null or length(trim(p_name)) < 3 or length(trim(p_name)) > 32 then
    raise exception 'INVALID_FAMILY_NAME';
  end if;

  if p_tag is null or length(trim(p_tag)) < 2 or length(trim(p_tag)) > 5 then
    raise exception 'INVALID_FAMILY_TAG';
  end if;

  if exists (select 1 from public.families where lower(name) = lower(p_name)) then
    raise exception 'FAMILY_NAME_TAKEN';
  end if;

  if exists (select 1 from public.families where lower(tag) = lower(p_tag)) then
    raise exception 'FAMILY_TAG_TAKEN';
  end if;

  -- Create the family
  insert into public.families (name, tag, description)
  values (trim(p_name), upper(trim(p_tag)), p_description)
  returning * into new_family;

  -- Creator becomes the Boss and is linked
  insert into public.family_members (family_id, player_id, role)
  values (new_family.id, auth.uid(), 'boss');

  -- Update player
  update public.players
  set family_id = new_family.id
  where id = auth.uid();

  return to_jsonb(new_family);
end;
$$;

-- Join an existing family
create or replace function public.join_family(p_family_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_family public.families;
  my_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is not null then
    raise exception 'ALREADY_IN_FAMILY';
  end if;

  select * into target_family from public.families where id = p_family_id;
  if target_family.id is null then
    raise exception 'FAMILY_NOT_FOUND';
  end if;

  -- Optional: could add max member limit later
  -- if target_family.member_count >= 50 then raise exception 'FAMILY_FULL'; end if;

  insert into public.family_members (family_id, player_id, role)
  values (p_family_id, auth.uid(), 'soldier');

  update public.players
  set family_id = p_family_id
  where id = auth.uid();

  return to_jsonb(target_family);
end;
$$;

-- Leave current family
create or replace function public.leave_family()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_family_id uuid;
  my_role text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is null then
    return false; -- not in a family
  end if;

  -- Get current role
  select role into my_role from public.family_members 
  where family_id = my_family_id and player_id = auth.uid();

  -- If boss, we could prevent leaving unless they promote someone first.
  -- For now allow it (family may become leaderless).
  delete from public.family_members
  where family_id = my_family_id and player_id = auth.uid();

  update public.players
  set family_id = null
  where id = auth.uid();

  -- Optional cleanup: if no members left, we could delete the family here.
  -- For now we keep empty families.

  return true;
end;
$$;

-- Get current player's family + basic info
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

  -- Return family + role + top members (simple version)
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

-- List all families (lightweight, for browsing)
create or replace function public.list_families()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'tag', tag,
      'respect', respect,
      'territory', territory,
      'member_count', member_count
    )
    order by respect desc, member_count desc
  )
  from public.families
  limit 100;
$$;
