-- 080: Real blackjack + video poker (jacks or better)
--
-- The stateful half of the casino standalones. Unlike play_casino's coin flip,
-- these deal from an actual 52-card deck held server-side: the client never
-- sees the deck, only its own cards, so it can't know or pick what comes next.
--
-- Cards are 0..51. rank = card % 13 (0=A, 1=2 … 9=10, 10=J, 11=Q, 12=K),
-- suit = card / 13 (0=spades, 1=hearts, 2=diamonds, 3=clubs).
--
-- House edge:
--   BLACKJACK    dealer stands on all 17, naturals pay 3:2, no double/split.
--                The edge is the real one: the player busts first and loses
--                the stake even when the dealer would also have busted.
--   VIDEO POKER  6/5 Jacks or Better paytable -> ~95% RTP.

-- ---------------------------------------------------------------------------
-- 1. hand state
-- ---------------------------------------------------------------------------

create table if not exists public.casino_hands (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  game         text not null check (game in ('blackjack','vpoker')),
  bet          bigint not null check (bet > 0),
  deck         int[] not null,
  player_cards int[] not null default '{}',
  dealer_cards int[] not null default '{}',
  state        text not null default 'active' check (state in ('active','done')),
  result       text,
  payout       bigint not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.casino_hands enable row level security;
-- No policy: the deck must never be readable by the client. RPCs only.

-- One hand in play per game per player.
create unique index if not exists casino_one_active_hand
  on public.casino_hands (player_id, game) where state = 'active';

-- ---------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------

create or replace function public._new_deck()
returns int[] language sql volatile as $$
  select array_agg(i order by random()) from generate_series(0, 51) i;
$$;

-- Best blackjack total: aces count 11 until that would bust, then 1.
create or replace function public._bj_value(p_cards int[])
returns int
language plpgsql
immutable
as $$
declare
  c int; r int; total int := 0; aces int := 0;
begin
  foreach c in array p_cards loop
    r := c % 13;
    if r = 0 then aces := aces + 1; total := total + 11;
    elsif r >= 9 then total := total + 10;   -- 10, J, Q, K
    else total := total + r + 1;
    end if;
  end loop;
  while total > 21 and aces > 0 loop
    total := total - 10; aces := aces - 1;
  end loop;
  return total;
end;
$$;

create or replace function public._vp_evaluate(p_cards int[])
returns text
language plpgsql
immutable
as $$
declare
  v_is_flush boolean;
  v_is_straight boolean := false;
  v_is_royal boolean := false;
  v_counts int[];
  v_ranks int[];
  v_top int; v_second int;
  v_high_pair boolean;
begin
  select count(distinct x / 13) = 1 into v_is_flush from unnest(p_cards) x;

  select array_agg(cnt order by cnt desc) into v_counts
  from (select count(*) cnt from unnest(p_cards) x group by x % 13) q;

  v_top := v_counts[1];
  v_second := coalesce(v_counts[2], 0);

  select array_agg(distinct x % 13 order by x % 13) into v_ranks from unnest(p_cards) x;

  if array_length(v_ranks, 1) = 5 then
    if v_ranks[5] - v_ranks[1] = 4 then
      v_is_straight := true;
    elsif v_ranks = array[0,9,10,11,12] then   -- A,10,J,Q,K
      v_is_straight := true;
      v_is_royal := true;
    end if;
  end if;

  -- A pair only pays from jacks up: A(0), J(10), Q(11), K(12).
  select exists(
    select 1 from (select x % 13 rk, count(*) c from unnest(p_cards) x group by x % 13) z
    where z.c = 2 and z.rk in (0,10,11,12)
  ) into v_high_pair;

  if v_is_royal and v_is_flush then return 'royal_flush'; end if;
  if v_is_straight and v_is_flush then return 'straight_flush'; end if;
  if v_top = 4 then return 'four_kind'; end if;
  if v_top = 3 and v_second = 2 then return 'full_house'; end if;
  if v_is_flush then return 'flush'; end if;
  if v_is_straight then return 'straight'; end if;
  if v_top = 3 then return 'three_kind'; end if;
  if v_top = 2 and v_second = 2 then return 'two_pair'; end if;
  if v_top = 2 and v_high_pair then return 'jacks_better'; end if;
  return 'nothing';
end;
$$;

-- 6/5 Jacks or Better. Multiplier is the TOTAL returned per unit staked,
-- so jacks_better = 1 is the stake back.
create or replace function public._vp_multiplier(p_hand text)
returns int language sql immutable as $$
  select case p_hand
    when 'royal_flush'    then 250
    when 'straight_flush' then 50
    when 'four_kind'      then 25
    when 'full_house'     then 6
    when 'flush'          then 5
    when 'straight'       then 4
    when 'three_kind'     then 3
    when 'two_pair'       then 2
    when 'jacks_better'   then 1
    else 0
  end;
$$;

revoke all on function public._new_deck() from public, anon, authenticated;
revoke all on function public._bj_value(int[]) from public, anon, authenticated;
revoke all on function public._vp_evaluate(int[]) from public, anon, authenticated;
revoke all on function public._vp_multiplier(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. blackjack
-- ---------------------------------------------------------------------------

create or replace function public.bj_deal(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_deck   int[];
  v_player int[];
  v_dealer int[];
  v_id     uuid;
  v_pv int; v_dv int;
  v_result text; v_payout bigint := 0; v_state text := 'active';
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_bet < 100 or p_bet > 500000 then raise exception 'INVALID_BET'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.cash < p_bet then raise exception 'NOT_ENOUGH_CASH'; end if;

  if exists (select 1 from public.casino_hands
              where player_id = p.id and game = 'blackjack' and state = 'active') then
    raise exception 'HAND_IN_PROGRESS';
  end if;

  v_deck := public._new_deck();
  v_player := array[v_deck[1], v_deck[3]];
  v_dealer := array[v_deck[2], v_deck[4]];
  v_deck := v_deck[5:52];

  -- Stake leaves the wallet now; anything won comes back at settle time.
  update public.players set cash = cash - p_bet where id = p.id;

  v_pv := public._bj_value(v_player);
  v_dv := public._bj_value(v_dealer);

  if v_pv = 21 then
    v_state := 'done';
    if v_dv = 21 then
      v_result := 'push'; v_payout := p_bet;
    else
      v_result := 'blackjack'; v_payout := p_bet + floor(p_bet * 1.5)::bigint;  -- 3:2
    end if;
    update public.players set cash = cash + v_payout where id = p.id;
  elsif v_dv = 21 then
    v_state := 'done'; v_result := 'lose'; v_payout := 0;
    perform public.add_to_casino_pool('blackjack', p_bet);
  end if;

  insert into public.casino_hands (player_id, game, bet, deck, player_cards, dealer_cards, state, result, payout)
  values (p.id, 'blackjack', p_bet, v_deck, v_player, v_dealer, v_state, v_result, v_payout)
  returning id into v_id;

  return jsonb_build_object(
    'hand_id', v_id,
    'bet', p_bet,
    'player_cards', v_player,
    'player_value', v_pv,
    -- Hole card stays hidden while the hand is live.
    'dealer_cards', case when v_state = 'done' then to_jsonb(v_dealer) else to_jsonb(array[v_dealer[1]]) end,
    'dealer_value', case when v_state = 'done' then v_dv else null end,
    'state', v_state,
    'result', v_result,
    'payout', v_payout,
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

create or replace function public.bj_hit()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h public.casino_hands;
  v_card int;
  v_pv int;
  v_state text := 'active';
  v_result text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into h from public.casino_hands
   where player_id = auth.uid() and game = 'blackjack' and state = 'active'
   for update;
  if h.id is null then raise exception 'NO_ACTIVE_HAND'; end if;

  v_card := h.deck[1];
  h.deck := h.deck[2:array_length(h.deck,1)];
  h.player_cards := h.player_cards || v_card;

  v_pv := public._bj_value(h.player_cards);

  if v_pv > 21 then
    v_state := 'done'; v_result := 'bust';
    perform public.add_to_casino_pool('blackjack', h.bet);
  end if;

  update public.casino_hands
     set deck = h.deck, player_cards = h.player_cards, state = v_state, result = v_result
   where id = h.id;

  return jsonb_build_object(
    'hand_id', h.id,
    'player_cards', h.player_cards,
    'player_value', v_pv,
    'dealer_cards', case when v_state = 'done' then to_jsonb(h.dealer_cards) else to_jsonb(array[h.dealer_cards[1]]) end,
    'dealer_value', case when v_state = 'done' then public._bj_value(h.dealer_cards) else null end,
    'state', v_state,
    'result', v_result,
    'payout', 0,
    'new_cash', (select cash from public.players where id = auth.uid())
  );
end;
$$;

create or replace function public.bj_stand()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h public.casino_hands;
  v_pv int; v_dv int;
  v_result text; v_payout bigint := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into h from public.casino_hands
   where player_id = auth.uid() and game = 'blackjack' and state = 'active'
   for update;
  if h.id is null then raise exception 'NO_ACTIVE_HAND'; end if;

  v_pv := public._bj_value(h.player_cards);

  -- Dealer stands on all 17.
  v_dv := public._bj_value(h.dealer_cards);
  while v_dv < 17 loop
    h.dealer_cards := h.dealer_cards || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck,1)];
    v_dv := public._bj_value(h.dealer_cards);
  end loop;

  if v_dv > 21 or v_pv > v_dv then
    v_result := 'win'; v_payout := h.bet * 2;
  elsif v_pv = v_dv then
    v_result := 'push'; v_payout := h.bet;
  else
    v_result := 'lose'; v_payout := 0;
  end if;

  if v_payout > 0 then
    update public.players set cash = cash + v_payout where id = auth.uid();
  else
    perform public.add_to_casino_pool('blackjack', h.bet);
  end if;

  update public.casino_hands
     set deck = h.deck, dealer_cards = h.dealer_cards,
         state = 'done', result = v_result, payout = v_payout
   where id = h.id;

  return jsonb_build_object(
    'hand_id', h.id,
    'player_cards', h.player_cards,
    'player_value', v_pv,
    'dealer_cards', h.dealer_cards,
    'dealer_value', v_dv,
    'state', 'done',
    'result', v_result,
    'payout', v_payout,
    'profit', v_payout - h.bet,
    'new_cash', (select cash from public.players where id = auth.uid())
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. video poker
-- ---------------------------------------------------------------------------

create or replace function public.vp_deal(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p      public.players;
  v_deck int[];
  v_hand int[];
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_bet < 100 or p_bet > 500000 then raise exception 'INVALID_BET'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.cash < p_bet then raise exception 'NOT_ENOUGH_CASH'; end if;

  if exists (select 1 from public.casino_hands
              where player_id = p.id and game = 'vpoker' and state = 'active') then
    raise exception 'HAND_IN_PROGRESS';
  end if;

  v_deck := public._new_deck();
  v_hand := v_deck[1:5];
  v_deck := v_deck[6:52];

  update public.players set cash = cash - p_bet where id = p.id;

  insert into public.casino_hands (player_id, game, bet, deck, player_cards, state)
  values (p.id, 'vpoker', p_bet, v_deck, v_hand, 'active')
  returning id into v_id;

  return jsonb_build_object(
    'hand_id', v_id,
    'bet', p_bet,
    'cards', v_hand,
    'current', public._vp_evaluate(v_hand),
    'state', 'active',
    'new_cash', (select cash from public.players where id = p.id)
  );
end;
$$;

-- p_holds: which of the 5 positions to keep, e.g. '{1,3,5}'. Empty = redraw all.
create or replace function public.vp_draw(p_holds int[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h        public.casino_hands;
  v_final  int[] := '{}';
  v_i      int;
  v_next   int := 1;
  v_hand   text;
  v_mult   int;
  v_payout bigint := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into h from public.casino_hands
   where player_id = auth.uid() and game = 'vpoker' and state = 'active'
   for update;
  if h.id is null then raise exception 'NO_ACTIVE_HAND'; end if;

  if p_holds is not null and exists (select 1 from unnest(p_holds) x where x < 1 or x > 5) then
    raise exception 'INVALID_HOLDS';
  end if;

  for v_i in 1..5 loop
    if p_holds is not null and v_i = any(p_holds) then
      v_final := v_final || h.player_cards[v_i];
    else
      v_final := v_final || h.deck[v_next];
      v_next := v_next + 1;
    end if;
  end loop;

  v_hand := public._vp_evaluate(v_final);
  v_mult := public._vp_multiplier(v_hand);
  v_payout := h.bet * v_mult;

  if v_payout > 0 then
    update public.players set cash = cash + v_payout where id = auth.uid();
  else
    perform public.add_to_casino_pool('general', h.bet);
  end if;

  update public.casino_hands
     set player_cards = v_final,
         deck = h.deck[v_next:array_length(h.deck,1)],
         state = 'done', result = v_hand, payout = v_payout
   where id = h.id;

  return jsonb_build_object(
    'hand_id', h.id,
    'cards', v_final,
    'hand', v_hand,
    'multiplier', v_mult,
    'bet', h.bet,
    'payout', v_payout,
    'profit', v_payout - h.bet,
    'state', 'done',
    'new_cash', (select cash from public.players where id = auth.uid())
  );
end;
$$;

-- Resume a hand left open by a refresh — without ever leaking the deck.
create or replace function public.get_casino_hand(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  h public.casino_hands;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into h from public.casino_hands
   where player_id = auth.uid() and game = p_game and state = 'active'
   limit 1;

  if h.id is null then return jsonb_build_object('active', false); end if;

  if p_game = 'blackjack' then
    return jsonb_build_object(
      'active', true, 'hand_id', h.id, 'bet', h.bet,
      'player_cards', h.player_cards,
      'player_value', public._bj_value(h.player_cards),
      'dealer_cards', to_jsonb(array[h.dealer_cards[1]])
    );
  end if;

  return jsonb_build_object(
    'active', true, 'hand_id', h.id, 'bet', h.bet,
    'cards', h.player_cards,
    'current', public._vp_evaluate(h.player_cards)
  );
end;
$$;

revoke all on function public.bj_deal(bigint) from public, anon;
revoke all on function public.bj_hit() from public, anon;
revoke all on function public.bj_stand() from public, anon;
revoke all on function public.vp_deal(bigint) from public, anon;
revoke all on function public.vp_draw(int[]) from public, anon;
revoke all on function public.get_casino_hand(text) from public, anon;

grant execute on function public.bj_deal(bigint) to authenticated;
grant execute on function public.bj_hit() to authenticated;
grant execute on function public.bj_stand() to authenticated;
grant execute on function public.vp_deal(bigint) to authenticated;
grant execute on function public.vp_draw(int[]) to authenticated;
grant execute on function public.get_casino_hand(text) to authenticated;
