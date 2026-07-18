-- 098_hustlers_way_and_stats.sql
-- =====================================================================
-- Hustler's Way (daily / weekly / family task board) + Crime Leaderboard
-- ---------------------------------------------------------------------
-- Server-authoritative progression:
--   * player_stats  : lifetime + daily action counters (1:1 with players)
--   * hustler_progress : per-player daily/weekly/family task state
--   * record_hustler_progress() + bump_player_stat() : called from the
--     existing action RPCs (one line each) so progress is never client-
--     controlled. RPCs are re-CREATEd below with that single hook added.
--   * get_hustler_tasks() : idempotent on-read reset (NL midnight GMT+1)
--   * claim_hustler_task() : atomic reward bundle + rare item drop
--   * get_crime_leaderboard() / get_my_stats() : shareable rankings
-- =====================================================================

-- ---------- 1) player stats (lifetime + per-day counters) ----------
create table if not exists public.player_stats (
  username text primary key references public.players(username) on delete cascade,
  crimes_done        bigint not null default 0,
  heists_done        bigint not null default 0,
  murders_done       bigint not null default 0,
  races_won          bigint not null default 0,
  drugs_bought       bigint not null default 0,
  drugs_sold         bigint not null default 0,
  casino_bets        bigint not null default 0,
  laundered_batches  bigint not null default 0,
  -- daily snapshot (resets at NL midnight)
  daily_crimes       bigint not null default 0,
  daily_heists       bigint not null default 0,
  daily_murders      bigint not null default 0,
  daily_races        bigint not null default 0,
  daily_drugs        bigint not null default 0,
  daily_casino       bigint not null default 0,
  daily_launders     bigint not null default 0,
  day_date           date not null default timezone('Europe/Amsterdam', now())::date,
  created_at         timestamptz not null default now()
);
alter table public.player_stats enable row level security;
create policy "stats readable by everyone"
  on public.player_stats for select using (true);
create policy "players manage own stats"
  on public.player_stats for all
  using (username = (select username from public.players where id = auth.uid()))
  with check (username = (select username from public.players where id = auth.uid()));

-- ensure a stats row exists for the caller (idempotent)
create or replace function public.ensure_player_stats()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_uname text;
begin
  select username into v_uname from public.players where id = auth.uid();
  if v_uname is null then return; end if;
  insert into public.player_stats (username) values (v_uname)
    on conflict (username) do nothing;
  -- reset daily snapshot if the NL day rolled over
  update public.player_stats
     set daily_crimes=0, daily_heists=0, daily_murders=0, daily_races=0,
         daily_drugs=0, daily_casino=0, daily_launders=0,
         day_date = timezone('Europe/Amsterdam', now())::date
   where username = v_uname
     and day_date <> timezone('Europe/Amsterdam', now())::date;
end;
$$;

-- bump a lifetime + daily counter by 1 (used by action RPCs)
create or replace function public.bump_player_stat(p_kind text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ensure_player_stats();
  case p_kind
    when 'crime' then
      update public.player_stats set crimes_done = crimes_done + 1, daily_crimes = daily_crimes + 1 where username = (select username from public.players where id = auth.uid());
    when 'heist' then
      update public.player_stats set heists_done = heists_done + 1, daily_heists = daily_heists + 1 where username = (select username from public.players where id = auth.uid());
    when 'murder' then
      update public.player_stats set murders_done = murders_done + 1, daily_murders = daily_murders + 1 where username = (select username from public.players where id = auth.uid());
    when 'race' then
      update public.player_stats set races_won = races_won + 1, daily_races = daily_races + 1 where username = (select username from public.players where id = auth.uid());
    when 'drug_buy' then
      update public.player_stats set drugs_bought = drugs_bought + 1, daily_drugs = daily_drugs + 1 where username = (select username from public.players where id = auth.uid());
    when 'drug_sell' then
      update public.player_stats set drugs_sold = drugs_sold + 1, daily_drugs = daily_drugs + 1 where username = (select username from public.players where id = auth.uid());
    when 'casino' then
      update public.player_stats set casino_bets = casino_bets + 1, daily_casino = daily_casino + 1 where username = (select username from public.players where id = auth.uid());
    when 'launder' then
      update public.player_stats set laundered_batches = laundered_batches + 1, daily_launders = daily_launders + 1 where username = (select username from public.players where id = auth.uid());
    else null;
  end case;
end;
$$;

-- ---------- 2) hustler progress (daily / weekly / family tasks) ----------
create table if not exists public.hustler_progress (
  username text primary key references public.players(username) on delete cascade,
  daily_tasks    jsonb not null default '[]'::jsonb,
  daily_claimed  jsonb not null default '[]'::jsonb,
  daily_date     date  not null default timezone('Europe/Amsterdam', now())::date,
  weekly_tasks   jsonb not null default '[]'::jsonb,
  weekly_claimed jsonb not null default '[]'::jsonb,
  weekly_num     int   not null default extract(week from timezone('Europe/Amsterdam', now())),
  family_task    jsonb,
  family_claimed boolean not null default false,
  family_week    int   not null default extract(week from timezone('Europe/Amsterdam', now())),
  daily_streak   int   not null default 0,
  last_daily_date date,
  total_xp       bigint not null default 0,
  hustler_rank   int   not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.hustler_progress enable row level security;
create policy "hustler progress own row"
  on public.hustler_progress for all
  using (username = (select username from public.players where id = auth.uid()))
  with check (username = (select username from public.players where id = auth.uid()));

-- generate a shuffled set of N daily tasks deterministically per day
create or replace function public._roll_daily_tasks(p_seed text)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  pool jsonb := jsonb_build_array(
    jsonb_build_object('type','crime','target',8,'reward_money',250000,'reward_xp',120,'reward_respect',40),
    jsonb_build_object('type','heist','target',3,'reward_money',600000,'reward_xp',200,'reward_respect',60),
    jsonb_build_object('type','drug_buy','target',40,'reward_money',150000,'reward_xp',90,'reward_respect',25),
    jsonb_build_object('type','drug_sell','target',40,'reward_money',150000,'reward_xp',90,'reward_respect',25),
    jsonb_build_object('type','casino','target',10,'reward_money',120000,'reward_xp',80,'reward_respect',20),
    jsonb_build_object('type','race','target',2,'reward_money',200000,'reward_xp',150,'reward_respect',35),
    jsonb_build_object('type','murder','target',3,'reward_money',400000,'reward_xp',180,'reward_respect',80),
    jsonb_build_object('type','launder','target',2,'reward_money',180000,'reward_xp',100,'reward_respect',30)
  );
  shuffled jsonb := '[]'::jsonb;
  i int; j int; tmp jsonb; n int := jsonb_array_length(pool);
  r double precision;
begin
  -- Fisher-Yates shuffle seeded by a stable per-day string
  perform setseed(0); -- stable base
  for i in 0..n-1 loop
    r := (ascii(substring(p_seed from (i % length(p_seed)) + 1))::float + i) / 255.0;
    j := floor(r * (i + 1))::int;
    tmp := pool->i;
    pool := jsonb_set(pool, array[i::text], pool->j);
    pool := jsonb_set(pool, array[j::text], tmp);
  end loop;
  for i in 0..2 loop
    shuffled := shuffled || jsonb_build_array(
      jsonb_set(pool->i, '{id}', to_jsonb('d' || i))
    );
  end loop;
  return shuffled;
end;
$$;

-- generate 2 weekly tasks (one may be a 2-player co-op type)
create or replace function public._roll_weekly_tasks(p_seed text)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  pool jsonb := jsonb_build_array(
    jsonb_build_object('type','crime','target',50,'reward_money',1500000,'reward_xp',600,'reward_respect',200),
    jsonb_build_object('type','heist','target',8,'reward_money',3000000,'reward_xp',900,'reward_respect',300),
    jsonb_build_object('type','drug_sell','target',200,'reward_money',1200000,'reward_xp',500,'reward_respect',160),
    jsonb_build_object('type','casino','target',60,'reward_money',900000,'reward_xp',400,'reward_respect',120),
    jsonb_build_object('type','race','target',10,'reward_money',1000000,'reward_xp',550,'reward_respect',150),
    jsonb_build_object('type','murder','target',12,'reward_money',2500000,'reward_xp',800,'reward_respect',400),
    jsonb_build_object('type','coop_crime','target',30,'reward_money',2000000,'reward_xp',700,'reward_respect',250),
    jsonb_build_object('type','coop_heist','target',4,'reward_money',3500000,'reward_xp',1000,'reward_respect',350)
  );
  a jsonb; b jsonb;
begin
  a := pool->floor(random() * jsonb_array_length(pool))::int;
  loop
    b := pool->floor(random() * jsonb_array_length(pool))::int;
    exit when (b->>'type') <> (a->>'type');
  end loop;
  return jsonb_build_array(
    jsonb_set(a, '{id}', to_jsonb('w0')),
    jsonb_set(b, '{id}', to_jsonb('w1'))
  );
end;
$$;

-- generate the family weekly collective task
create or replace function public._roll_family_task(p_seed text)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  opts jsonb := jsonb_build_array(
    jsonb_build_object('type','crime','target',200,'power',120,'cash_per',5000),
    jsonb_build_object('type','heist','target',30,'power',180,'cash_per',12000),
    jsonb_build_object('type','drug_sell','target',600,'power',140,'cash_per',3000),
    jsonb_build_object('type','murder','target',40,'power',220,'cash_per',9000)
  );
begin
  return jsonb_set(opts->floor(random() * jsonb_array_length(opts))::int, '{progress}', to_jsonb(0));
end;
$$;

-- record progress toward the player's active daily/weekly (+family) tasks
create or replace function public.record_hustler_progress(p_type text, p_amount int default 1)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uname text;
  hp public.hustler_progress;
  dt jsonb := '[]'::jsonb;
  wt jsonb := '[]'::jsonb;
  el jsonb; new_el jsonb; i int;
  fam_id uuid;
begin
  select username into v_uname from public.players where id = auth.uid();
  if v_uname is null then return; end if;
  select * into hp from public.hustler_progress where username = v_uname for update;
  if hp.username is null then
    insert into public.hustler_progress (username) values (v_uname);
    select * into hp from public.hustler_progress where username = v_uname for update;
  end if;

  -- DAILY
  for i in 0..jsonb_array_length(hp.daily_tasks)-1 loop
    el := hp.daily_tasks->i;
    if el->>'type' = p_type and (hp.daily_claimed ? (el->>'id')) = false then
      new_el := jsonb_set(el, '{progress}', to_jsonb(least((el->>'target')::int, (el->>'progress')::int + p_amount)));
      dt := dt || jsonb_build_array(new_el);
    else
      dt := dt || jsonb_build_array(el);
    end if;
  end loop;
  -- WEEKLY (incl. coop types that map to a base action)
  for i in 0..jsonb_array_length(hp.weekly_tasks)-1 loop
    el := hp.weekly_tasks->i;
    if (hp.weekly_claimed ? (el->>'id')) = false and (
         el->>'type' = p_type
         or (el->>'type' = 'coop_crime' and p_type = 'crime')
         or (el->>'type' = 'coop_heist' and p_type = 'heist')
       ) then
      new_el := jsonb_set(el, '{progress}', to_jsonb(least((el->>'target')::int, (el->>'progress')::int + p_amount)));
      wt := wt || jsonb_build_array(new_el);
    else
      wt := wt || jsonb_build_array(el);
    end if;
  end loop;

  update public.hustler_progress set daily_tasks = dt, weekly_tasks = wt where username = v_uname;

  -- FAMILY weekly: only the matching action type, only if in a family
  select family_id into fam_id from public.players where id = auth.uid();
  if fam_id is not null and hp.family_task is not null and hp.family_claimed = false
     and hp.family_task->>'type' = p_type then
    update public.hustler_progress
       set family_task = jsonb_set(family_task, '{progress}',
             to_jsonb(least((family_task->>'target')::int, (family_task->>'progress')::int + p_amount)))
     where username = v_uname;
  end if;
end;
$$;

-- read (and lazily reset) the player's task board
create or replace function public.get_hustler_tasks()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uname text;
  hp public.hustler_progress;
  today date := timezone('Europe/Amsterdam', now())::date;
  wk int := extract(week from timezone('Europe/Amsterdam', now()));
  seed text;
begin
  select username into v_uname from public.players where id = auth.uid();
  if v_uname is null then raise exception 'NO_PLAYER'; end if;
  select * into hp from public.hustler_progress where username = v_uname for update;
  if hp.username is null then
    insert into public.hustler_progress (username) values (v_uname);
    select * into hp from public.hustler_progress where username = v_uname for update;
  end if;

  if hp.daily_date <> today then
    seed := 'd' || today;
    update public.hustler_progress
       set daily_tasks = public._roll_daily_tasks(seed),
           daily_claimed = '[]'::jsonb,
           daily_date = today
     where username = v_uname;
  end if;
  if hp.weekly_num <> wk then
    seed := 'w' || wk;
    update public.hustler_progress
       set weekly_tasks = public._roll_weekly_tasks(seed),
           weekly_claimed = '[]'::jsonb,
           weekly_num = wk
     where username = v_uname;
  end if;
  if hp.family_week <> wk then
    seed := 'f' || wk;
    update public.hustler_progress
       set family_task = public._roll_family_task(seed),
           family_claimed = false,
           family_week = wk
     where username = v_uname;
  end if;

  select * into hp from public.hustler_progress where username = v_uname;
  return jsonb_build_object(
    'daily_tasks', hp.daily_tasks,
    'daily_claimed', hp.daily_claimed,
    'daily_date', hp.daily_date,
    'weekly_tasks', hp.weekly_tasks,
    'weekly_claimed', hp.weekly_claimed,
    'weekly_num', hp.weekly_num,
    'family_task', hp.family_task,
    'family_claimed', hp.family_claimed,
    'family_week', hp.family_week,
    'daily_streak', hp.daily_streak,
    'last_daily_date', hp.last_daily_date,
    'total_xp', hp.total_xp,
    'hustler_rank', hp.hustler_rank,
    'next_reset', (timezone('Europe/Amsterdam', now())::date + 1)::timestamp::timestamptz at time zone 'UTC'
  );
end;
$$;

-- grant a random rare item that mirrors a shop/VIP reward (slow to grind there)
create or replace function public.grant_hustler_item(p_uname text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  roll double precision := random();
  p public.players;
begin
  select * into p from public.players where username = p_uname for update;
  if p.id is null then return jsonb_build_object('item', null); end if;

  if roll < 0.30 then
    -- protection point (armor tier)
    update public.players set protection = least(50, protection + 5) where id = p.id;
    return jsonb_build_object('item', 'protection', 'label', 'Armor (+5)');
  elsif roll < 0.50 then
    -- personal bodyguard
    update public.players set bodyguards = least(5, bodyguards + 1) where id = p.id;
    return jsonb_build_object('item', 'bodyguard', 'label', 'Personal Bodyguard');
  elsif roll < 0.68 then
    -- diamonds
    update public.players set diamonds = diamonds + 25 where id = p.id;
    return jsonb_build_object('item', 'diamonds', 'label', '25 Diamonds');
  elsif roll < 0.82 then
    -- temporary donator day-pass (24h) — refreshes donator_until window
    update public.players
       set donator_until = greatest(coalesce(donator_until, now()), now()) + interval '1 day'
     where id = p.id;
    return jsonb_build_object('item', 'donator_day', 'label', 'Donator Day-Pass (24h)');
  elsif roll < 0.92 then
    -- energy refresh (refill stamina/energy)
    update public.players set energy = max_energy, energy_updated_at = now() where id = p.id;
    return jsonb_build_object('item', 'energy', 'label', 'Energy Refresh');
  else
    -- property discount coupon (5% off next purchase, stored as a flag)
    update public.players set property_coupon = coalesce(property_coupon, 0) + 1 where id = p.id;
    return jsonb_build_object('item', 'property_coupon', 'label', 'Property Coupon');
  end if;
end;
$$;

-- claim a completed task; atomically grant the reward bundle
create or replace function public.claim_hustler_task(p_scope text, p_task_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uname text;
  v_fam text;
  hp public.hustler_progress;
  tasks jsonb;
  claimed jsonb;
  el jsonb; found_task jsonb; i int;
  reward_money bigint := 0; reward_xp int := 0; reward_respect int := 0;
  fam_id uuid; fam_power int := 0; cash_per bigint := 0;
  item jsonb;
begin
  select username into v_uname from public.players where id = auth.uid();
  if v_uname is null then raise exception 'NO_PLAYER'; end if;
  select * into hp from public.hustler_progress where username = v_uname for update;

  if p_scope = 'family' then
    if hp.family_task is null then raise exception 'NO_FAMILY_TASK'; end if;
    if hp.family_claimed then raise exception 'ALREADY_CLAIMED'; end if;
    if (hp.family_task->>'progress')::int < (hp.family_task->>'target')::int then raise exception 'NOT_COMPLETE'; end if;
    select family_id, family_name into fam_id, v_fam from public.players where id = auth.uid();
    if fam_id is null then raise exception 'NOT_IN_FAMILY'; end if;
    fam_power := (hp.family_task->>'power')::int;
    update public.families set power = coalesce(power,0) + fam_power where id = fam_id;
    update public.hustler_progress set family_claimed = true where username = v_uname;
    return jsonb_build_object('success', true, 'scope', 'family', 'family_power', fam_power);
  end if;

  if p_scope = 'daily' then tasks := hp.daily_tasks; claimed := hp.daily_claimed;
  elsif p_scope = 'weekly' then tasks := hp.weekly_tasks; claimed := hp.weekly_claimed;
  else raise exception 'BAD_SCOPE'; end if;

  for i in 0..jsonb_array_length(tasks)-1 loop
    el := tasks->i;
    if el->>'id' = p_task_id then found_task := el; exit; end if;
  end loop;
  if found_task is null then raise exception 'TASK_NOT_FOUND'; end if;
  if (claimed ? p_task_id) then raise exception 'ALREADY_CLAIMED'; end if;
  if (found_task->>'progress')::int < (found_task->>'target')::int then raise exception 'NOT_COMPLETE'; end if;

  reward_money := (found_task->>'reward_money')::bigint;
  reward_xp   := (found_task->>'reward_xp')::int;
  reward_respect := (found_task->>'reward_respect')::int;

  -- streak handling for daily
  if p_scope = 'daily' then
    if hp.last_daily_date = (timezone('Europe/Amsterdam', now())::date - 1) then
      hp.daily_streak := hp.daily_streak + 1;
    elsif hp.last_daily_date is distinct from timezone('Europe/Amsterdam', now())::date then
      hp.daily_streak := 1;
    end if;
    -- streak bonus
    if hp.daily_streak >= 7 then reward_money := reward_money + floor(reward_money * 0.25);
    elsif hp.daily_streak >= 3 then reward_money := reward_money + floor(reward_money * 0.10); end if;
  end if;

  update public.players
     set cash = cash + reward_money,
         xp = xp + reward_xp,
         total_xp = total_xp + reward_xp
   where id = (select id from public.players where username = v_uname);

  -- family respect (a bit) if in a family
  select family_id into fam_id from public.players where username = v_uname;
  if fam_id is not null and reward_respect > 0 then
    update public.families set respect = respect + reward_respect where id = fam_id;
  end if;

  -- mark claimed
  claimed := claimed || to_jsonb(p_task_id);
  if p_scope = 'daily' then
    update public.hustler_progress
       set daily_tasks = tasks, daily_claimed = claimed,
           daily_streak = hp.daily_streak, last_daily_date = timezone('Europe/Amsterdam', now())::date,
           total_xp = total_xp + reward_xp,
           hustler_rank = case when total_xp + reward_xp >= 100000 then 3
                               when total_xp + reward_xp >= 25000 then 2
                               when total_xp + reward_xp >= 5000 then 1 else 0 end
     where username = v_uname;
  else
    update public.hustler_progress
       set weekly_tasks = tasks, weekly_claimed = claimed,
           total_xp = total_xp + reward_xp,
           hustler_rank = case when total_xp + reward_xp >= 100000 then 3
                               when total_xp + reward_xp >= 25000 then 2
                               when total_xp + reward_xp >= 5000 then 1 else 0 end
     where username = v_uname;
  end if;

  -- rare item drop (8% chance)
  item := jsonb_build_object('item', null);
  if random() < 0.08 then
    item := public.grant_hustler_item(v_uname);
  end if;

  return jsonb_build_object('success', true, 'scope', p_scope, 'task_id', p_task_id,
    'reward_money', reward_money, 'reward_xp', reward_xp, 'reward_respect', reward_respect,
    'item', item, 'streak', hp.daily_streak);
end;
$$;

-- ---------- 3) Crime Leaderboard (shareable rankings) ----------
create or replace function public.get_crime_leaderboard()
returns jsonb language sql security definer set search_path = ''
stable
as $$
  select jsonb_build_object(
    'top_crimes', coalesce((
      select jsonb_agg(jsonb_build_object('username', s.username, 'value', s.crimes_done))
      from (select username, crimes_done from public.player_stats order by crimes_done desc nulls last limit 20) s
    ), '[]'::jsonb),
    'top_heists', coalesce((
      select jsonb_agg(jsonb_build_object('username', s.username, 'value', s.heists_done))
      from (select username, heists_done from public.player_stats order by heists_done desc nulls last limit 20) s
    ), '[]'::jsonb),
    'top_murders', coalesce((
      select jsonb_agg(jsonb_build_object('username', s.username, 'value', s.murders_done))
      from (select username, murders_done from public.player_stats order by murders_done desc nulls last limit 20) s
    ), '[]'::jsonb),
    'top_races', coalesce((
      select jsonb_agg(jsonb_build_object('username', s.username, 'value', s.races_won))
      from (select username, races_won from public.player_stats order by races_won desc nulls last limit 20) s
    ), '[]'::jsonb),
    'top_drugs', coalesce((
      select jsonb_agg(jsonb_build_object('username', s.username, 'value', s.drugs_sold))
      from (select username, drugs_sold from public.player_stats order by drugs_sold desc nulls last limit 20) s
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_my_stats()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uname text; s public.player_stats;
begin
  select username into v_uname from public.players where id = auth.uid();
  if v_uname is null then raise exception 'NO_PLAYER'; end if;
  perform public.ensure_player_stats();
  select * into s from public.player_stats where username = v_uname;
  if s.username is null then
    return jsonb_build_object('username', v_uname, 'crimes_done',0,'heists_done',0,'murders_done',0,
      'races_won',0,'drugs_bought',0,'drugs_sold',0,'casino_bets',0,'laundered_batches',0);
  end if;
  return jsonb_build_object(
    'username', s.username,
    'crimes_done', s.crimes_done, 'heists_done', s.heists_done, 'murders_done', s.murders_done,
    'races_won', s.races_won, 'drugs_bought', s.drugs_bought, 'drugs_sold', s.drugs_sold,
    'casino_bets', s.casino_bets, 'laundered_batches', s.laundered_batches
  );
end;
$$;

grant execute on function public.get_crime_leaderboard() to authenticated, anon;
grant execute on function public.get_my_stats() to authenticated;
grant execute on function public.get_hustler_tasks() to authenticated;
grant execute on function public.claim_hustler_task(text, text) to authenticated;
grant execute on function public.record_hustler_progress(text, int) to authenticated;
grant execute on function public.bump_player_stat(text) to authenticated;

-- ---------- 5) supporting player columns (new progression rewards) ----------
alter table public.players add column if not exists donator_until timestamptz;
alter table public.players add column if not exists property_coupon int not null default 0;

-- =====================================================================
-- 4) Hook the action RPCs (re-CREATEd with a single progress line each).
--    Bodies are identical to their current definitions; only the two
--    PERFORM lines below are added at the success point.
-- =====================================================================

-- commit_crime (base: 071)
CREATE OR REPLACE FUNCTION public.commit_crime(crime_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  p public.players;
  c public.crimes;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  succeeded boolean;
  mult numeric;
  reward bigint := 0;
  gained_xp int := 0;
  leveled_up boolean := false;
  xp_needed bigint;
  heat_gain int;
  police_roll numeric;
  extra_jail int := 0;
  murder_gain numeric := 0;
  health_loss int := 0;
  final_loss int := 0;
  risk_multiplier numeric;
  v_event jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into c from public.crimes where key = commit_crime.crime_key;
  if c.key is null then raise exception 'UNKNOWN_CRIME'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.level < c.min_level then raise exception 'LEVEL_TOO_LOW'; end if;
  select available_at into existing_cd from public.crime_cooldowns where player_id = p.id and crime_key = c.key;
  if existing_cd is not null and existing_cd > now() then raise exception 'ON_COOLDOWN'; end if;
  case c.key
    when 'pickpocket' then risk_multiplier := 1.0;
    when 'rob_store'  then risk_multiplier := 2.5;
    when 'steal_car'  then risk_multiplier := 4.0;
    when 'warehouse_heist' then risk_multiplier := 8.0;
    when 'train_murder' then risk_multiplier := 7.0;
    else risk_multiplier := 3.0;
  end case;
  p.stamina := public._spend_stamina(p.id, greatest(1, ceil(risk_multiplier))::int);
  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));
  succeeded := random() < c.success_chance;
  health_loss := ceil(2 * risk_multiplier);
  if not succeeded then health_loss := health_loss + ceil(4 * risk_multiplier); end if;
  final_loss := greatest(1, health_loss - floor(p.protection * 0.4));
  p.health := greatest(0, p.health - final_loss);
  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.dirty_cash := coalesce(p.dirty_cash, 0) + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;
    PERFORM public.record_hustler_progress('crime', 1);
    PERFORM public.bump_player_stat('crime');
    if c.key = 'train_murder' then
      murder_gain := 0.02; p.murder_skill := p.murder_skill + murder_gain; heat_gain := 15;
    else heat_gain := 3; end if;
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;
    if c.key = 'train_murder' then
      p.jailed_until := now() + make_interval(secs => 300); heat_gain := 25;
    else
      p.jailed_until := now() + make_interval(secs => c.jail_seconds); heat_gain := 12;
    end if;
  end if;
  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);
  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;
  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed; p.level := p.level + 1; leveled_up := true; xp_needed := p.level * 100;
  end loop;
  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key) do update set available_at = excluded.available_at;
  update public.players
  set dirty_cash = p.dirty_cash, level = p.level, xp = p.xp, health = p.health,
      jailed_until = p.jailed_until, heat = p.heat, heat_updated_at = now(),
      murder_skill = p.murder_skill, crimes_succeeded = p.crimes_succeeded, crimes_failed = p.crimes_failed
  where id = p.id;
  if succeeded then
    v_event := public._roll_random_event(p.id);
  end if;
  return jsonb_build_object('success', succeeded, 'reward', reward, 'xp_gained', gained_xp,
    'leveled_up', leveled_up, 'available_at', next_available, 'murder_skill_gained', murder_gain,
    'health_lost', final_loss, 'stamina', p.stamina, 'event', v_event, 'player', to_jsonb(p));
end;
$function$;

-- commit_heist (base: 071)
CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size integer, bullets_used integer DEFAULT 0, weapon text DEFAULT NULL::text, car_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  p public.players;
  h record;
  car public.player_cars;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  base_success numeric;
  gear_bonus numeric := 0;
  crew_bonus numeric;
  bullet_bonus numeric := 0;
  weapon_bonus numeric := 0;
  getaway_bonus numeric := 0;
  total_success numeric;
  succeeded boolean;
  reward bigint := 0;
  gained_xp int := 0;
  heat_gain int;
  final_crew int;
  bullets_spent int;
  health_loss numeric;
  v_event jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF weapon IS NULL OR btrim(weapon) = '' THEN RAISE EXCEPTION 'WEAPON_REQUIRED'; END IF;
  IF car_id IS NULL THEN RAISE EXCEPTION 'CAR_REQUIRED'; END IF;
  SELECT * INTO h FROM public.heists WHERE key = heist_key;
  IF h.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_HEIST'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF NOT (COALESCE(p.weapons, '[]'::jsonb) ? weapon) THEN RAISE EXCEPTION 'WEAPON_NOT_OWNED'; END IF;
  SELECT * INTO car FROM public.player_cars WHERE id = car_id AND player_id = p.id FOR UPDATE;
  IF car.id IS NULL THEN RAISE EXCEPTION 'CAR_NOT_OWNED'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.level < h.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;
  SELECT available_at INTO existing_cd FROM public.heist_cooldowns WHERE player_id = p.id AND heist_key = h.key;
  IF existing_cd IS NOT NULL AND existing_cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;
  p.stamina := public._spend_stamina(p.id, 15);
  final_crew := LEAST(GREATEST(crew_size, 2), 3);
  bullets_spent := GREATEST(0, LEAST(COALESCE(bullets_used, 0), 500));
  IF COALESCE(p.bullets, 0) < bullets_spent THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
  bullet_bonus := LEAST(15, bullets_spent / 10.0);
  weapon_bonus  := public._weapon_bonus(weapon);
  getaway_bonus := LEAST(10, floor(car.condition / 12.0) + CASE WHEN car.tuned THEN 2 ELSE 0 END);
  cooldown_mult := GREATEST(0.5, 1 - (p.rebirths * 0.1));
  IF p.heist_gear IS NOT NULL THEN
    gear_bonus := COALESCE((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  ELSE
    gear_bonus := p.protection * 0.6;
  END IF;
  crew_bonus := (final_crew - 1) * 10;
  base_success := h.base_success;
  total_success := LEAST(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100)
    + (bullet_bonus / 100) + (weapon_bonus / 100) + (getaway_bonus / 100) - (p.heat / 250.0));
  succeeded := random() < total_success;
  p.bullets := COALESCE(p.bullets, 0) - bullets_spent;
  IF succeeded THEN
    health_loss := 1 + random() * 2;
    reward := ((h.min_reward + FLOOR(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := FLOOR(h.xp * (1 + p.rebirths * 0.25));
    p.dirty_cash := COALESCE(p.dirty_cash, 0) + reward;
    p.power := p.power + FLOOR(reward / 20);
    PERFORM public.record_hustler_progress('heist', 1);
    PERFORM public.bump_player_stat('heist');
    heat_gain := 6;
  ELSE
    health_loss := 5 + random() * 10;
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 18;
  END IF;
  p.health := GREATEST(0, p.health - health_loss);
  IF p.health <= 0 THEN
    p.death_until := now() + make_interval(secs => 3600);
    p.health := 0;
  END IF;
  p.xp := p.xp + gained_xp;
  p.heat := LEAST(100, p.heat + heat_gain);
  DECLARE xp_needed bigint := p.level * 100;
  BEGIN
    WHILE p.xp >= xp_needed LOOP
      p.xp := p.xp - xp_needed; p.level := p.level + 1; xp_needed := p.level * 100;
    END LOOP;
  END;
  UPDATE public.player_cars SET condition = GREATEST(0, condition - 8) WHERE id = car.id;
  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;
  UPDATE public.players SET dirty_cash = p.dirty_cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, heat_updated_at = now(), bullets = p.bullets WHERE id = p.id;
  IF succeeded THEN
    PERFORM public.log_event('heist', 'pulled off the ' || replace(h.key, '_', ' ') || ' for $' || reward || '!');
    v_event := public._roll_random_event(p.id);
  END IF;
  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', weapon, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', ROUND(total_success * 100),
    'available_at', next_available, 'stamina', p.stamina, 'event', v_event,
    'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$function$;

-- attempt_murder (base: 071)
CREATE OR REPLACE FUNCTION public.attempt_murder(target_username text, weapon text, bullets_used integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.players WHERE username = target_username FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF attacker.id = target.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;
  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);
  IF attacker_level < 16 OR attacker_skill < 10 THEN
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;
  attacker.stamina := public._spend_stamina(attacker.id, 15);
  attacker.bullets := GREATEST(0, COALESCE(attacker.bullets, 0) - bullets_used);
  IF COALESCE(target.bodyguards, 0) > 0 THEN
    UPDATE public.players SET bodyguards = bodyguards - 1 WHERE id = target.id;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 10);
    cooldown_end := now() + interval '10 minutes';
    attacker.murder_cooldown := cooldown_end;
    UPDATE public.players SET
      heat = attacker.heat, heat_updated_at = now(),
      bullets = attacker.bullets, murder_cooldown = attacker.murder_cooldown
    WHERE id = attacker.id;
    RETURN jsonb_build_object(
      'success', false, 'blocked', true, 'stolen', 0,
      'guards_left', COALESCE(target.bodyguards, 0) - 1,
      'cooldown_until', cooldown_end, 'stamina', attacker.stamina,
      'player', to_jsonb(attacker)
    );
  END IF;
  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));
  IF attacker_skill >= 15 THEN success_chance := success_chance + 15; END IF;
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;
  success_chance := success_chance + LEAST(20, bullets_used / 25);
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;
  succeeded := random() < (success_chance / 100);
  IF succeeded THEN
    stolen := FLOOR(target.cash * 0.2);
    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := COALESCE(attacker.murder_skill, 0) + skill_gain;
    PERFORM public.record_hustler_progress('murder', 1);
    PERFORM public.bump_player_stat('murder');
    heat_gain := 15;
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain + 10);
  END IF;
  attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '1 hour';
  attacker.murder_cooldown := cooldown_end;
  UPDATE public.players SET
    dirty_cash = attacker.dirty_cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
    heat_updated_at = now(),
    bullets = attacker.bullets,
    murder_cooldown = attacker.murder_cooldown
  WHERE id = attacker.id;
  IF succeeded THEN
    target.cash := GREATEST(0, target.cash - stolen);
    UPDATE public.players SET cash = target.cash WHERE id = target.id;
  END IF;
  RETURN jsonb_build_object(
    'success', succeeded,
    'stolen', COALESCE(stolen, 0),
    'skill_gained', CASE WHEN succeeded THEN skill_gain ELSE 0 END,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
END;
$function$;

-- attempt_hit (base: 071)
CREATE OR REPLACE FUNCTION public.attempt_hit(target_player_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.03;
  health_loss numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF auth.uid() = target_player_id THEN RAISE EXCEPTION 'CANNOT_HIT_SELF'; END IF;
  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.players WHERE id = target_player_id FOR UPDATE;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN
    RAISE EXCEPTION 'DEAD';
  END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN
    RAISE EXCEPTION 'IN_JAIL';
  END IF;
  IF attacker.kill_protected_until IS NOT NULL AND attacker.kill_protected_until > now() THEN
    RAISE EXCEPTION 'KILL_PROTECTED';
  END IF;
  success_chance := LEAST(0.85, GREATEST(0.15, (attacker.murder_skill + 5) / (target.level + 10) * 0.6 ));
  succeeded := random() < success_chance;
  IF succeeded THEN
    health_loss := 2 + random() * 3;
    stolen := FLOOR(target.cash * 0.15 + random() * 200);
    IF stolen > target.cash THEN stolen := target.cash; END IF;
    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := attacker.murder_skill + skill_gain;
    PERFORM public.record_hustler_progress('murder', 1);
    PERFORM public.bump_player_stat('murder');
    attacker.heat := LEAST(100, attacker.heat + 15);
    target.cash := target.cash - stolen;
    target.heat := LEAST(100, target.heat + 10);
    UPDATE public.players SET dirty_cash = attacker.dirty_cash, murder_skill = attacker.murder_skill,
      heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
    UPDATE public.players SET cash = target.cash, heat = target.heat WHERE id = target.id;
    RETURN jsonb_build_object('success', true, 'stolen', stolen, 'skill_gained', skill_gain, 'player', to_jsonb(attacker));
  ELSE
    health_loss := 5 + random() * 10;
    attacker.health := GREATEST(0, attacker.health - health_loss);
    attacker.heat := LEAST(100, attacker.heat + 25);
    IF attacker.health <= 0 THEN
      attacker.death_until := now() + make_interval(secs => 3600);
      attacker.kill_protected_until := null;
    END IF;
    attacker.jailed_until := now() + make_interval(secs => 300);
    UPDATE public.players SET health = attacker.health, death_until = attacker.death_until,
      heat = attacker.heat, heat_updated_at = now(), jailed_until = attacker.jailed_until WHERE id = attacker.id;
    RETURN jsonb_build_object('success', false, 'jail_time', 300, 'health_lost', health_loss, 'player', to_jsonb(attacker));
  END IF;
END;
$function$;

-- buy_drug (base: 071)
CREATE OR REPLACE FUNCTION public.buy_drug(p_drug text, p_qty int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  unit_price int;
  cost bigint;
  tax bigint;
  total bigint;
  have int;
  cap int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  unit_price := public._drug_price(p.current_city, p_drug);
  cost  := unit_price::bigint * p_qty;
  tax   := floor(cost * 0.015)::bigint;
  total := cost + tax;
  IF p.cash < total THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  cap  := public._drug_cap(p_drug);
  IF have + p_qty > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;
  new_storage := jsonb_set(
    COALESCE(p.drug_storage, '{}'::jsonb),
    ARRAY[p_drug],
    to_jsonb(have + p_qty)
  );
  UPDATE public.players
  SET cash = cash - total,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      drug_storage = new_storage
  WHERE id = p.id;
  PERFORM public.record_hustler_progress('drug_buy', 1);
  PERFORM public.bump_player_stat('drug_buy');
  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty,
                            'unit_price', unit_price, 'tax', tax, 'total', total,
                            'storage', new_storage);
END;
$$;

-- sell_drug (base: 071)
CREATE OR REPLACE FUNCTION public.sell_drug(p_drug text, p_qty integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  p public.players; unit_price int; revenue bigint; have int; new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;
  unit_price := public._drug_price(p.current_city, p_drug);
  revenue := unit_price::bigint * p_qty;
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[p_drug], to_jsonb(have - p_qty));
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + revenue, drug_storage = new_storage WHERE id = p.id;
  PERFORM public.record_hustler_progress('drug_sell', 1);
  PERFORM public.bump_player_stat('drug_sell');
  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty, 'unit_price', unit_price, 'revenue', revenue, 'storage', new_storage);
END;
$function$;

-- play_casino (base: 043)
CREATE OR REPLACE FUNCTION public.play_casino(game text, bet bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  p public.players;
  win_chance numeric := 0.48;
  won boolean;
  payout bigint := 0;
  pool text := 'general';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF bet < 100 OR bet > 500000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < bet THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
  IF game = 'blackjack' THEN
    win_chance := 0.485; pool := 'blackjack';
  ELSIF game = 'roulette' THEN
    win_chance := 0.46; pool := 'roulette';
  ELSE
    win_chance := 0.47; pool := 'general';
  END IF;
  IF COALESCE(p.is_donator, false) THEN
    win_chance := win_chance + 0.015;
  END IF;
  won := random() < win_chance;
  p.cash := p.cash - bet;
  IF won THEN
    payout := FLOOR(bet * 1.95);
    p.cash := p.cash + payout;
  ELSE
    PERFORM public.add_to_casino_pool(pool, bet);
  END IF;
  UPDATE public.players SET cash = p.cash WHERE id = p.id;
  PERFORM public.record_hustler_progress('casino', 1);
  PERFORM public.bump_player_stat('casino');
  RETURN jsonb_build_object(
    'won', won, 'bet', bet, 'payout', payout, 'new_cash', p.cash,
    'game', game, 'player', to_jsonb(p)
  );
END;
$function$;

-- launder_via_property (base: 096)
CREATE OR REPLACE FUNCTION public.launder_via_property(p_prop_id text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p          public.players;
  new_props  jsonb := '[]'::jsonb;
  el         jsonb;
  found      boolean := false;
  tier       record;
  fee        bigint;
  ready_at   timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount IS NULL OR p_amount < 100 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF COALESCE(p.dirty_cash, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_DIRTY_CASH'; END IF;
  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF NOT found AND el->>'id' = p_prop_id THEN
      IF COALESCE((el->>'launder_pending')::bigint, 0) > 0 THEN
        RAISE EXCEPTION 'BATCH_ACTIVE';
      END IF;
      SELECT * INTO tier FROM public._property_launder_tier(el->>'ptype');
      IF p_amount > tier.capacity THEN RAISE EXCEPTION 'OVER_CAPACITY'; END IF;
      fee      := floor(p_amount * tier.fee_pct)::bigint;
      ready_at := now() + make_interval(secs => tier.wash_seconds);
      el := jsonb_set(el, '{launder_pending}',    to_jsonb(p_amount));
      el := jsonb_set(el, '{launder_fee}',        to_jsonb(fee));
      el := jsonb_set(el, '{launder_started_at}', to_jsonb(now()));
      el := jsonb_set(el, '{launder_ready_at}',   to_jsonb(ready_at));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;
  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;
  UPDATE public.players
     SET dirty_cash = dirty_cash - p_amount,
         owned_properties = new_props
   WHERE id = p.id;
  PERFORM public.record_hustler_progress('launder', 1);
  PERFORM public.bump_player_stat('launder');
  RETURN jsonb_build_object('success', true, 'pending', p_amount, 'fee', fee,
    'ready_at', ready_at, 'new_dirty', COALESCE(p.dirty_cash, 0) - p_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.launder_via_property(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.launder_via_property(text, bigint) TO authenticated;

-- rip_player (base: 077)
create or replace function public.rip_player(target_username text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  attacker public.players;
  target   public.players;
  cd timestamptz;
  lvl_diff int;
  stat_edge numeric;
  success_chance numeric;
  succeeded boolean;
  pct numeric;
  stolen bigint := 0;
  v_bounty jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF attacker.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  SELECT * INTO target FROM public.players WHERE username = target_username FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target.id = attacker.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF target.death_until IS NOT NULL AND target.death_until > now() THEN RAISE EXCEPTION 'TARGET_DEAD'; END IF;
  IF target.kill_protected_until IS NOT NULL AND target.kill_protected_until > now() THEN RAISE EXCEPTION 'TARGET_PROTECTED'; END IF;
  IF COALESCE(target.cash, 0) < 100 THEN RAISE EXCEPTION 'TARGET_NO_CASH'; END IF;
  SELECT available_at INTO cd FROM public.rip_cooldowns
   WHERE attacker_id = attacker.id AND target_id = target.id;
  IF cd IS NOT NULL AND cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;
  attacker.stamina := public._spend_stamina(attacker.id, 10);
  INSERT INTO public.rip_cooldowns (attacker_id, target_id, available_at)
  VALUES (attacker.id, target.id, now() + interval '4 seconds')
  ON CONFLICT (attacker_id, target_id) DO UPDATE SET available_at = excluded.available_at;
  IF COALESCE(target.bodyguards, 0) > 0 THEN
    UPDATE public.players SET bodyguards = bodyguards - 1 WHERE id = target.id;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 3);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
    RETURN jsonb_build_object(
      'success', false, 'blocked', true, 'target', target.username,
      'guards_left', COALESCE(target.bodyguards, 0) - 1,
      'new_heat', attacker.heat, 'stamina', attacker.stamina
    );
  END IF;
  lvl_diff := COALESCE(attacker.level, 1) - COALESCE(target.level, 1);
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := LEAST(90, GREATEST(20, 60 + lvl_diff * 3 + stat_edge));
  succeeded := random() < (success_chance / 100.0);
  IF succeeded THEN
    pct := 0.10 + random() * 0.10;
    stolen := GREATEST(1, FLOOR(target.cash * pct));
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 5);
    UPDATE public.players SET cash = GREATEST(0, cash - stolen) WHERE id = target.id;
    UPDATE public.players
       SET dirty_cash = COALESCE(dirty_cash, 0) + stolen,
           heat = attacker.heat, heat_updated_at = now()
     WHERE id = attacker.id;
    PERFORM public.record_hustler_progress('murder', 1);
    PERFORM public.bump_player_stat('murder');
    PERFORM public.log_event('rip', 'ripped ' || target.username || ' for $' || stolen || '!');
    v_bounty := public._try_claim_bounty(attacker.id, target.id);
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 15);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
  END IF;
  RETURN jsonb_build_object(
    'success', succeeded, 'stolen', stolen, 'target', target.username,
    'success_chance', ROUND(success_chance),
    'new_dirty', COALESCE(attacker.dirty_cash, 0) + CASE WHEN succeeded THEN stolen ELSE 0 END,
    'new_heat', attacker.heat, 'stamina', attacker.stamina,
    'bounty', v_bounty
  );
END;
$$;

-- run_race (base: 066)
CREATE OR REPLACE FUNCTION public.run_race(race_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r public.races;
  caller uuid;
  poster_wins boolean;
  winner_id uuid;
  loser_id uuid;
  w_name text;
  loser_cash bigint;
  transfer bigint;
BEGIN
  caller := auth.uid();
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.races WHERE id = race_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RACE_NOT_FOUND'; END IF;
  IF r.status <> 'ready' THEN RAISE EXCEPTION 'RACE_NOT_READY'; END IF;
  IF caller <> r.poster_id AND caller <> r.joined_by THEN RAISE EXCEPTION 'NOT_YOUR_RACE'; END IF;
  poster_wins := random() < 0.5;
  winner_id := CASE WHEN poster_wins THEN r.poster_id ELSE r.joined_by END;
  loser_id  := CASE WHEN poster_wins THEN r.joined_by ELSE r.poster_id END;
  w_name    := CASE WHEN poster_wins THEN r.poster_name ELSE r.joined_name END;
  SELECT cash INTO loser_cash FROM public.players WHERE id = loser_id FOR UPDATE;
  transfer := LEAST(r.bet, GREATEST(0, COALESCE(loser_cash, 0)));
  UPDATE public.players SET cash = cash - transfer WHERE id = loser_id;
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + transfer WHERE id = winner_id;
  UPDATE public.races SET status = 'finished', winner_name = w_name WHERE id = race_id;
  IF winner_id = caller THEN
    PERFORM public.record_hustler_progress('race', 1);
    PERFORM public.bump_player_stat('race');
  END IF;
  PERFORM public.log_event('race', COALESCE(w_name, 'Someone') || ' won a $' || transfer || ' street race!');
  RETURN jsonb_build_object('success', true, 'winner', w_name, 'pot', transfer, 'you_won', winner_id = caller);
END;
$function$;
