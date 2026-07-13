-- ============================================================
-- LEADERBOARD
-- Public ranking: username, level, rebirths only.
-- Never exposes emails or cash. Sorted by rebirths, then level,
-- then XP; ties broken by who got there first.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

create or replace function public.get_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      id,
      username,
      level,
      rebirths,
      row_number() over (
        order by rebirths desc, level desc, xp desc, created_at asc
      ) as pos
    from public.players
    where username is not null
  )
  select jsonb_build_object(
    'top', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'pos', pos,
            'username', username,
            'level', level,
            'rebirths', rebirths
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
        'rebirths', rebirths
      )
      from ranked
      where id = auth.uid()
    )
  );
$$;
