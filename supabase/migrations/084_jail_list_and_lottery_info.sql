-- 084: Real jail roster + real lottery info
--
-- Two read RPCs that replace fabricated frontend data with the truth:
--
--   * The jail page showed a hardcoded list ("Rival1 45m", "Thief2 20m") that
--     had nothing to do with who was actually locked up.
--   * The lottery page invented a weekly "Friday draw" countdown and a fake
--     "1 vs 3 tickets" split, and never told the player the real \$5,000 ticket
--     cost, the real 37/42% odds, the live pool, or their 7-day cooldown.
--
-- Both are DEFINER because players is RLS owner-read and these have to see
-- across the whole server.

-- ---------------------------------------------------------------------------
-- who is actually in jail
-- ---------------------------------------------------------------------------

create or replace function public.get_jailed_players()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'username', username,
      'city', current_city,
      'level', level,
      'minutes_left', ceil(extract(epoch from (jailed_until - now())) / 60.0)::int
    ) order by jailed_until desc)
    from public.players
    where jailed_until is not null and jailed_until > now()
    limit 50
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- the real lottery numbers (must mirror enter_weekly_lottery)
-- ---------------------------------------------------------------------------

create or replace function public.get_lottery_info()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  p          public.players;
  v_pool     bigint;
  v_next     timestamptz;
  ticket_cost constant bigint := 5000;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  select lottery into v_pool from public.casino_pools where id = 1;
  v_pool := coalesce(v_pool, 0);

  -- Cooldown is 7 days per player from their last entry (not a global draw).
  v_next := case when p.lottery_last_entry is not null
                 then p.lottery_last_entry + interval '7 days' end;

  return jsonb_build_object(
    'ticket_cost', ticket_cost,
    -- Odds match enter_weekly_lottery exactly.
    'win_chance', case when coalesce(p.is_donator, false) then 42 else 37 end,
    'is_donator', coalesce(p.is_donator, false),
    'pool', v_pool,
    -- Once the pool clears $200k a win pays 8% of it; below that it's a flat band.
    'pool_active', v_pool > 200000,
    'jackpot_prize', case when v_pool > 200000 then floor(v_pool * 0.08)::bigint else null end,
    'base_prize_min', 25000,
    'base_prize_max', 105000,
    'can_enter', v_next is null or v_next <= now(),
    'next_entry_at', case when v_next is not null and v_next > now() then v_next end,
    'my_cash', p.cash
  );
end;
$$;

revoke all on function public.get_jailed_players() from public, anon;
revoke all on function public.get_lottery_info() from public, anon;
grant execute on function public.get_jailed_players() to authenticated;
grant execute on function public.get_lottery_info() to authenticated;
