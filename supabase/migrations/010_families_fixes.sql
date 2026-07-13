-- ============================================================
-- FIXES for Families + extended player leaderboard
-- 1) get_my_family crashed for players in a family (text role
--    was assigned to an int variable).
-- 2) get_leaderboard now includes family tag/name and crime
--    count, so the Global Leaderboard page can show them
--    without exposing emails or cash.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Fixed get_my_family
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

-- 2) Extended player leaderboard: adds crimes + family info
create or replace function public.get_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      p.id,
      p.username,
      p.level,
      p.rebirths,
      p.xp,
      p.crimes_succeeded,
      p.cash,
      p.created_at,
      f.tag as family_tag,
      f.name as family_name,
      row_number() over (
        order by p.rebirths desc, p.level desc, p.xp desc, p.created_at asc
      ) as pos
    from public.players p
    left join public.families f on f.id = p.family_id
    where p.username is not null
  )
  select jsonb_build_object(
    'top', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'pos', pos,
            'username', username,
            'level', level,
            'rebirths', rebirths,
            'crimes', crimes_succeeded,
            'cash', cash,
            'family_tag', family_tag,
            'family_name', family_name
          )
          order by pos
        ),
        '[]'::jsonb
      )
      from (select * from ranked order by pos limit 50) top50
    ),
    'me', (
      select jsonb_build_object(
        'pos', pos,
        'username', username,
        'level', level,
        'rebirths', rebirths,
        'crimes', crimes_succeeded,
        'cash', cash,
        'family_tag', family_tag,
        'family_name', family_name
      )
      from ranked
      where id = auth.uid()
    )
  );
$$;
