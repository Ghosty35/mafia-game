-- 076: Detective Agency + murder intel gate
--
-- Bug-inspectie spec: "Murder search takes 15 real minutes. Results sent via
-- Messages. You have 5 min to act after message notification."
--
-- The old /detective page was theatre: a client-side setTimeout picked a
-- RANDOM city and the browser INSERTed the 'report' into messages itself.
-- Now the agency is server-timed and the intel is real (the target's actual
-- city, snapshotted when the search completes).
--
-- This makes murder an operation instead of a button: locate the target, then
-- get to their city and act inside a 5 minute window before they move. It ties
-- the travel system (075) directly into the murder loop.
--
-- SECURITY FIX in the same migration: the messages INSERT policy let ANY
-- client write ANY message to ANY player — bypassing send_player_message's
-- 10s rate limit and 500-char cap entirely (verified exploitable: a 2000-char
-- message sent with no delay). Messages are now RPC-only; every legitimate
-- writer (send_player_message, respond_join_request, and this migration's
-- _detective_deliver) is SECURITY DEFINER and unaffected.

-- ---------------------------------------------------------------------------
-- 1. security fix — messages become RPC-only
-- ---------------------------------------------------------------------------

drop policy if exists "Players can send messages" on public.messages;
revoke insert on public.messages from authenticated, anon;
revoke delete, truncate on public.messages from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. searches
-- ---------------------------------------------------------------------------

create table if not exists public.detective_searches (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  target_id    uuid not null references public.players(id) on delete cascade,
  requested_at timestamptz not null default now(),
  ready_at     timestamptz not null,
  found_city   text,
  delivered    boolean not null default false,
  expires_at   timestamptz
);

alter table public.detective_searches enable row level security;

create policy "Players read their own searches"
  on public.detective_searches for select
  using ((select auth.uid()) = player_id);

-- One search in flight per player: the partial index only covers undelivered rows.
create unique index if not exists detective_one_pending
  on public.detective_searches (player_id) where not delivered;

create index if not exists detective_intel_lookup
  on public.detective_searches (player_id, target_id, expires_at);

-- ---------------------------------------------------------------------------
-- 3. lazy delivery (no cron — same pattern as heat decay / war resolution)
-- ---------------------------------------------------------------------------

create or replace function public._detective_deliver(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s record;
  v_city text;
  v_target text;
begin
  for s in
    select * from public.detective_searches
    where player_id = p_player_id and not delivered and ready_at <= now()
    for update
  loop
    -- Snapshot where the target actually is right now.
    select current_city, username into v_city, v_target
    from public.players where id = s.target_id;

    update public.detective_searches
    set found_city = v_city,
        delivered  = true,
        expires_at = now() + interval '5 minutes'
    where id = s.id;

    -- System message (from_player_id null = City Hall in the phone inbox).
    insert into public.messages (to_player_id, from_player_id, subject, body)
    values (
      p_player_id,
      null,
      'Detective report: ' || coalesce(v_target, 'unknown'),
      'Our man tailed ' || coalesce(v_target, 'the target') || ' to ' || coalesce(v_city, 'an unknown location') ||
      '. The intel is good for 5 minutes — get there and act before they move.'
    );
  end loop;
end;
$$;

revoke all on function public._detective_deliver(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. hire / read
-- ---------------------------------------------------------------------------

create or replace function public.hire_detective(p_target_username text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_target public.players;
  v_cost   bigint := 25000;
  v_ready  timestamptz;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;

  select * into v_target from public.players where username ilike p_target_username;
  if v_target.id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if v_target.id = p.id then raise exception 'CANNOT_TARGET_SELF'; end if;

  -- Clear any finished search first so the one-pending index reflects reality.
  perform public._detective_deliver(p.id);

  if exists (select 1 from public.detective_searches where player_id = p.id and not delivered) then
    raise exception 'SEARCH_IN_PROGRESS';
  end if;

  if p.cash < v_cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - v_cost where id = p.id;

  v_ready := now() + interval '15 minutes';

  insert into public.detective_searches (player_id, target_id, ready_at)
  values (p.id, v_target.id, v_ready);

  return jsonb_build_object(
    'success', true,
    'target', v_target.username,
    'cost', v_cost,
    'ready_at', v_ready
  );
end;
$$;

create or replace function public.get_my_detective()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Reading the page is what delivers a finished report.
  perform public._detective_deliver(auth.uid());

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'target', pl.username,
    'requested_at', s.requested_at,
    'ready_at', s.ready_at,
    'found_city', s.found_city,
    'delivered', s.delivered,
    'expires_at', s.expires_at,
    'target_city_now', case when s.delivered and s.expires_at > now() then pl.current_city end
  ) order by s.requested_at desc), '[]'::jsonb)
  into result
  from public.detective_searches s
  join public.players pl on pl.id = s.target_id
  where s.player_id = auth.uid()
    and s.requested_at > now() - interval '1 day';

  return jsonb_build_object(
    'searches', result,
    'cost', 25000,
    'my_city', (select current_city from public.players where id = auth.uid())
  );
end;
$$;

revoke all on function public.hire_detective(text) from public, anon;
revoke all on function public.get_my_detective() from public, anon;
grant execute on function public.hire_detective(text) to authenticated;
grant execute on function public.get_my_detective() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. murder now needs fresh intel + the target actually being there
-- ---------------------------------------------------------------------------

create or replace function public.attempt_murder(target_username text, weapon text, bullets_used integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  attacker public.players;
  target public.players;
  attacker_level int;
  attacker_skill numeric;
  stat_edge numeric;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.05;
  heat_gain int := 20;
  cooldown_end timestamptz;
  v_intel record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into attacker from public.players where id = auth.uid() for update;
  select * into target from public.players where username = target_username for update;

  if target.id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if attacker.id = target.id then raise exception 'CANNOT_TARGET_SELF'; end if;

  if attacker.jailed_until is not null and attacker.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if attacker.death_until is not null and attacker.death_until > now() then raise exception 'DEAD'; end if;

  if attacker.murder_cooldown is not null and attacker.murder_cooldown > now() then
    raise exception 'ON_MURDER_COOLDOWN';
  end if;

  attacker_level := attacker.level;
  attacker_skill := coalesce(attacker.murder_skill, 0);

  if attacker_level < 16 or attacker_skill < 10 then
    raise exception 'MURDER_LOCKED';
  end if;

  -- 076: you can only hit someone you've located, and only while the tip is warm.
  select * into v_intel
  from public.detective_searches
  where player_id = attacker.id
    and target_id = target.id
    and delivered
    and expires_at > now()
  order by expires_at desc
  limit 1;

  if v_intel.id is null then raise exception 'NO_INTEL'; end if;
  if attacker.current_city is distinct from target.current_city then raise exception 'TARGET_MOVED'; end if;

  attacker.stamina := public._spend_stamina(attacker.id, 15);

  attacker.bullets := greatest(0, coalesce(attacker.bullets, 0) - bullets_used);

  -- bodyguard takes the bullet (070): bullets are spent, shorter cooldown
  if coalesce(target.bodyguards, 0) > 0 then
    update public.players set bodyguards = bodyguards - 1 where id = target.id;
    attacker.heat := least(100, coalesce(attacker.heat, 0) + 10);
    cooldown_end := now() + interval '10 minutes';
    attacker.murder_cooldown := cooldown_end;
    update public.players set
      heat = attacker.heat, heat_updated_at = now(),
      bullets = attacker.bullets, murder_cooldown = attacker.murder_cooldown
    where id = attacker.id;
    return jsonb_build_object(
      'success', false, 'blocked', true, 'stolen', 0,
      'guards_left', coalesce(target.bodyguards, 0) - 1,
      'cooldown_until', cooldown_end, 'stamina', attacker.stamina,
      'player', to_jsonb(attacker)
    );
  end if;

  success_chance := least(90, greatest(10, attacker_skill * 5));
  if attacker_skill >= 15 then success_chance := success_chance + 15; end if;
  if weapon = 'Rifle' then success_chance := success_chance + 20;
  elsif weapon = 'SMG' then success_chance := success_chance + 10;
  end if;
  success_chance := success_chance + least(20, bullets_used / 25);
  stat_edge := least(15, greatest(-15, (coalesce(attacker.strength, 10) - coalesce(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;

  succeeded := random() < (success_chance / 100);

  if succeeded then
    stolen := floor(target.cash * 0.2);
    attacker.dirty_cash := coalesce(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := coalesce(attacker.murder_skill, 0) + skill_gain;
    heat_gain := 15;
  else
    attacker.heat := least(100, coalesce(attacker.heat, 0) + heat_gain + 10);
  end if;

  attacker.heat := least(100, coalesce(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '1 hour';
  attacker.murder_cooldown := cooldown_end;

  update public.players set
    dirty_cash = attacker.dirty_cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
    heat_updated_at = now(),
    bullets = attacker.bullets,
    murder_cooldown = attacker.murder_cooldown
  where id = attacker.id;

  if succeeded then
    target.cash := greatest(0, target.cash - stolen);
    update public.players set cash = target.cash where id = target.id;
  end if;

  -- Intel is burned whether or not the hit landed: the city knows now.
  update public.detective_searches set expires_at = now() where id = v_intel.id;

  return jsonb_build_object(
    'success', succeeded,
    'stolen', coalesce(stolen, 0),
    'skill_gained', case when succeeded then skill_gain else 0 end,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
end;
$$;
