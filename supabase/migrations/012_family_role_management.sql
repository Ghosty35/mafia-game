-- ============================================================
-- DEEPEN FAMILIES: Role Management (Promote / Demote)
-- This is core "deep gang management" from the plan
-- Only the Boss (or Underboss in future) can manage roles.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- Hierarchy for validation (lower number = higher rank)
-- boss = 1, underboss = 2, caporegime = 3, soldier = 4, associate = 5

create or replace function public.promote_member(
  p_target_player_id uuid,
  p_new_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_family_id uuid;
  my_role text;
  target_role text;
  target_family_id uuid;
  my_rank int;
  target_rank int;
  new_rank int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Get my family and role
  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is null then
    raise exception 'NOT_IN_FAMILY';
  end if;

  select role into my_role from public.family_members 
  where family_id = my_family_id and player_id = auth.uid();

  -- Only boss can promote for now (we can relax this later)
  if my_role != 'boss' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Get target info
  select family_id, role into target_family_id, target_role 
  from public.family_members 
  where player_id = p_target_player_id;

  if target_family_id is null or target_family_id != my_family_id then
    raise exception 'PLAYER_NOT_IN_YOUR_FAMILY';
  end if;

  -- Prevent promoting yourself
  if p_target_player_id = auth.uid() then
    raise exception 'CANNOT_PROMOTE_SELF';
  end if;

  -- Rank mapping
  my_rank := case my_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  target_rank := case target_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  new_rank := case p_new_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;

  -- You cannot promote someone to equal or higher than yourself (boss is top)
  if new_rank <= my_rank then
    raise exception 'CANNOT_PROMOTE_ABOVE_YOUR_RANK';
  end if;

  -- You cannot promote someone who is already higher than you
  if target_rank < my_rank then
    raise exception 'CANNOT_PROMOTE_HIGHER_RANK';
  end if;

  -- Update role
  update public.family_members
  set role = p_new_role
  where family_id = my_family_id and player_id = p_target_player_id;

  return jsonb_build_object(
    'success', true,
    'player_id', p_target_player_id,
    'new_role', p_new_role
  );
end;
$$;

create or replace function public.demote_member(
  p_target_player_id uuid,
  p_new_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_family_id uuid;
  my_role text;
  target_role text;
  target_family_id uuid;
  my_rank int;
  target_rank int;
  new_rank int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select family_id into my_family_id from public.players where id = auth.uid();
  if my_family_id is null then
    raise exception 'NOT_IN_FAMILY';
  end if;

  select role into my_role from public.family_members 
  where family_id = my_family_id and player_id = auth.uid();

  if my_role != 'boss' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select family_id, role into target_family_id, target_role 
  from public.family_members 
  where player_id = p_target_player_id;

  if target_family_id is null or target_family_id != my_family_id then
    raise exception 'PLAYER_NOT_IN_YOUR_FAMILY';
  end if;

  if p_target_player_id = auth.uid() then
    raise exception 'CANNOT_DEMOTE_SELF';
  end if;

  my_rank := case my_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  target_rank := case target_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  new_rank := case p_new_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;

  -- Cannot demote to higher or equal rank than yourself
  if new_rank <= my_rank then
    raise exception 'CANNOT_DEMOTE_TO_HIGHER_OR_EQUAL';
  end if;

  -- Cannot demote someone already lower
  if target_rank > my_rank then
    raise exception 'CANNOT_DEMOTE_LOWER_RANK';
  end if;

  update public.family_members
  set role = p_new_role
  where family_id = my_family_id and player_id = p_target_player_id;

  return jsonb_build_object(
    'success', true,
    'player_id', p_target_player_id,
    'new_role', p_new_role
  );
end;
$$;

-- Helper to get valid roles (for frontend)
create or replace function public.get_family_roles()
returns text[]
language sql
immutable
as $$
  select array['boss', 'underboss', 'caporegime', 'soldier', 'associate'];
$$;