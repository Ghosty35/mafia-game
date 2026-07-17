-- 079: Real roulette + rock/paper/scissors
--
-- Bug-inspectie wants Blackjack / Roulette / Poker / RPS as standalone games.
-- What exists today is play_casino(game, bet): one coin flip with the win
-- chance nudged by the game's NAME and a flat 1.95x payout. Roulette wasn't
-- roulette — it was a 46% coin toss with a wheel emoji.
--
-- These two are stateless (one call = one result), so they land first.
-- Blackjack and video poker need hand state and follow in 080.
--
-- House edge is real and comes from the maths, not a fudge factor:
--   ROULETTE  single-zero wheel, authentic payouts -> 2.70% edge on every bet
--   RPS       fair 1/3 outcomes, win pays 1.9x, draw returns stake -> 3.33%
--
-- Losing bets feed the existing casino pools (add_to_casino_pool), same as
-- play_casino did. That function is postgres/service_role-only since 061, and
-- these RPCs are DEFINER, so the internal PERFORM still works.

-- ---------------------------------------------------------------------------
-- roulette
-- ---------------------------------------------------------------------------

-- Single-zero (European) wheel. Red pockets, everything else 1-36 is black.
create or replace function public._roulette_is_red(p_n int)
returns boolean language sql immutable as $$
  select p_n in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36);
$$;

create or replace function public.roulette_spin(p_bet_type text, p_bet_value int, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_n      int;
  v_red    boolean;
  v_won    boolean := false;
  v_mult   int := 0;   -- total returned per unit staked (stake included)
  v_payout bigint := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_bet < 100 or p_bet > 500000 then raise exception 'INVALID_BET'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.cash < p_bet then raise exception 'NOT_ENOUGH_CASH'; end if;

  -- Validate the bet before spinning, so a bad bet can never eat the stake.
  if p_bet_type = 'straight' then
    if p_bet_value is null or p_bet_value < 0 or p_bet_value > 36 then raise exception 'INVALID_BET_VALUE'; end if;
  elsif p_bet_type in ('dozen','column') then
    if p_bet_value is null or p_bet_value < 1 or p_bet_value > 3 then raise exception 'INVALID_BET_VALUE'; end if;
  elsif p_bet_type not in ('red','black','odd','even','low','high') then
    raise exception 'INVALID_BET_TYPE';
  end if;

  -- The spin: 0..36, uniform.
  v_n := floor(random() * 37)::int;
  v_red := public._roulette_is_red(v_n);

  -- Zero loses every outside bet — that IS the house edge.
  if p_bet_type = 'straight' then
    v_won := (v_n = p_bet_value); v_mult := 36;          -- 35:1
  elsif v_n = 0 then
    v_won := false;
  elsif p_bet_type = 'red' then
    v_won := v_red; v_mult := 2;                          -- 1:1
  elsif p_bet_type = 'black' then
    v_won := not v_red; v_mult := 2;
  elsif p_bet_type = 'odd' then
    v_won := (v_n % 2 = 1); v_mult := 2;
  elsif p_bet_type = 'even' then
    v_won := (v_n % 2 = 0); v_mult := 2;
  elsif p_bet_type = 'low' then
    v_won := (v_n between 1 and 18); v_mult := 2;
  elsif p_bet_type = 'high' then
    v_won := (v_n between 19 and 36); v_mult := 2;
  elsif p_bet_type = 'dozen' then
    v_won := (ceil(v_n / 12.0)::int = p_bet_value); v_mult := 3;   -- 2:1
  elsif p_bet_type = 'column' then
    -- columns are 1,4,7.. / 2,5,8.. / 3,6,9..
    v_won := (case when v_n % 3 = 0 then 3 else v_n % 3 end = p_bet_value); v_mult := 3;
  end if;

  if v_won then
    v_payout := p_bet * v_mult;
    update public.players set cash = cash - p_bet + v_payout where id = p.id;
  else
    update public.players set cash = cash - p_bet where id = p.id;
    perform public.add_to_casino_pool('roulette', p_bet);
  end if;

  return jsonb_build_object(
    'number', v_n,
    'color', case when v_n = 0 then 'green' when v_red then 'red' else 'black' end,
    'won', v_won,
    'bet', p_bet,
    'bet_type', p_bet_type,
    'bet_value', p_bet_value,
    'payout', v_payout,
    'profit', case when v_won then v_payout - p_bet else -p_bet end,
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- rock / paper / scissors
-- ---------------------------------------------------------------------------

create or replace function public.rps_play(p_choice text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_house  text;
  v_result text;
  v_payout bigint := 0;
  choices  text[] := array['rock','paper','scissors'];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_bet < 100 or p_bet > 500000 then raise exception 'INVALID_BET'; end if;
  if p_choice is null or p_choice <> all(choices) then raise exception 'INVALID_CHOICE'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.cash < p_bet then raise exception 'NOT_ENOUGH_CASH'; end if;

  -- House picks blind and uniformly: no peeking at the player's choice.
  v_house := choices[floor(random() * 3)::int + 1];

  if v_house = p_choice then
    v_result := 'draw';
    v_payout := p_bet;                    -- stake back
  elsif (p_choice = 'rock'     and v_house = 'scissors')
     or (p_choice = 'paper'    and v_house = 'rock')
     or (p_choice = 'scissors' and v_house = 'paper') then
    v_result := 'win';
    v_payout := floor(p_bet * 1.9)::bigint;   -- 1.9x, not 2x: that's the edge
  else
    v_result := 'lose';
    v_payout := 0;
  end if;

  update public.players set cash = cash - p_bet + v_payout where id = p.id;

  if v_result = 'lose' then
    perform public.add_to_casino_pool('general', p_bet);
  end if;

  return jsonb_build_object(
    'result', v_result,
    'choice', p_choice,
    'house', v_house,
    'bet', p_bet,
    'payout', v_payout,
    'profit', v_payout - p_bet,
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

revoke all on function public._roulette_is_red(int) from public, anon, authenticated;
revoke all on function public.roulette_spin(text, int, bigint) from public, anon;
revoke all on function public.rps_play(text, bigint) from public, anon;
grant execute on function public.roulette_spin(text, int, bigint) to authenticated;
grant execute on function public.rps_play(text, bigint) to authenticated;
