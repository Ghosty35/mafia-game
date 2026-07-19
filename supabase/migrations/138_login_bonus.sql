-- 138_login_bonus.sql
-- Daily login streak bonus (Bulletstar "inlog bonus" reference, reworked as a
-- streak per the approved option). One claim per UTC day; consecutive days grow
-- the streak, a missed day resets it to 1. Reward cycles over 7 days (day 7 also
-- pays diamonds). Payout is CLEAN cash (a legit reward, not criminal income — 066).
-- Donators get 1.5x. Amounts are the gameplay balance; live-tunable later via _cfg.

alter table public.players
  add column if not exists login_streak int not null default 0,
  add column if not exists last_login_bonus timestamptz;

-- Internal: the reward for a given day-in-cycle (1..7).
create or replace function public._login_bonus_reward(p_day int)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  select case p_day
    when 1 then jsonb_build_object('cash', 10000,  'diamonds', 0)
    when 2 then jsonb_build_object('cash', 20000,  'diamonds', 0)
    when 3 then jsonb_build_object('cash', 35000,  'diamonds', 0)
    when 4 then jsonb_build_object('cash', 50000,  'diamonds', 0)
    when 5 then jsonb_build_object('cash', 75000,  'diamonds', 0)
    when 6 then jsonb_build_object('cash', 100000, 'diamonds', 0)
    when 7 then jsonb_build_object('cash', 150000, 'diamonds', 5)
    else jsonb_build_object('cash', 10000, 'diamonds', 0)
  end;
$$;

create or replace function public.get_login_bonus()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p          public.players;
  v_claimed  boolean;
  v_streak   int;
  v_next_day int;
  v_reward   jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  v_claimed := (p.last_login_bonus is not null and p.last_login_bonus::date = current_date);

  -- What streak/day THIS claim (or the next one) lands on.
  if v_claimed then
    v_streak := p.login_streak;                      -- today already banked
  elsif p.last_login_bonus is not null and p.last_login_bonus::date = current_date - 1 then
    v_streak := p.login_streak + 1;                  -- continuing the run
  else
    v_streak := 1;                                   -- fresh / broken run
  end if;

  v_next_day := ((greatest(v_streak, 1) - 1) % 7) + 1;
  v_reward := public._login_bonus_reward(v_next_day);
  if p.is_donator then
    v_reward := jsonb_build_object(
      'cash', floor((v_reward->>'cash')::bigint * 1.5)::bigint,
      'diamonds', (v_reward->>'diamonds')::int
    );
  end if;

  return jsonb_build_object(
    'streak', p.login_streak,
    'claimable', not v_claimed,
    'claimed_today', v_claimed,
    'day_in_cycle', v_next_day,          -- the day this/next claim pays
    'reward', v_reward,
    'is_donator', p.is_donator,
    'last_claim', p.last_login_bonus
  );
end;
$$;

create or replace function public.claim_login_bonus()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p          public.players;
  v_streak   int;
  v_day      int;
  v_reward   jsonb;
  v_cash     bigint;
  v_diamonds int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.last_login_bonus is not null and p.last_login_bonus::date = current_date then
    raise exception 'ALREADY_CLAIMED';
  end if;

  if p.last_login_bonus is not null and p.last_login_bonus::date = current_date - 1 then
    v_streak := p.login_streak + 1;
  else
    v_streak := 1;
  end if;

  v_day := ((v_streak - 1) % 7) + 1;
  v_reward := public._login_bonus_reward(v_day);
  v_cash := (v_reward->>'cash')::bigint;
  v_diamonds := (v_reward->>'diamonds')::int;
  if p.is_donator then
    v_cash := floor(v_cash * 1.5)::bigint;
  end if;

  update public.players
     set cash = cash + v_cash,              -- CLEAN cash (legit reward)
         diamonds = coalesce(diamonds, 0) + v_diamonds,
         login_streak = v_streak,
         last_login_bonus = now()
   where id = p.id;

  return jsonb_build_object(
    'success', true,
    'streak', v_streak,
    'day_in_cycle', v_day,
    'cash', v_cash,
    'diamonds', v_diamonds,
    'new_cash', p.cash + v_cash
  );
end;
$$;

revoke all on function public.get_login_bonus() from public, anon;
grant execute on function public.get_login_bonus() to authenticated;
revoke all on function public.claim_login_bonus() from public, anon;
grant execute on function public.claim_login_bonus() to authenticated;
