-- 077: Leaving the family costs you — and puts a price on your head
--
-- Bug-inspectie spec: "Leave Family — standalone page where players can leave
-- their family for a price, and a bounty on their head that can be claimed
-- ONLY by their ex-family members."
--
-- The exit fee IS the bounty: the money you pay to walk away is exactly what
-- your former crew can collect for hunting you down. Fee = 5% of your liquid
-- worth (cash + bank), floored at $25k and capped at $5M.
--
-- Claiming is automatic, not a button: when an ex-family member lands a rip
-- or a hit on you while the bounty is live, they collect it (as dirty cash —
-- it's blood money, per the 066 split). The bounty expires after 7 days.
--
-- Also fixes a real hole in the old leave_family(): the boss could walk out of
-- a populated family, leaving it headless with no way to promote anyone.

-- ---------------------------------------------------------------------------
-- 1. bounties
-- ---------------------------------------------------------------------------

create table if not exists public.family_bounties (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references public.players(id) on delete cascade,
  family_id  uuid not null references public.families(id) on delete cascade,
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid references public.players(id) on delete set null,
  claimed_at timestamptz
);

alter table public.family_bounties enable row level security;
-- Read goes through RPCs only (they scope to your family / yourself).

-- One live bounty per person.
create unique index if not exists family_bounties_one_active
  on public.family_bounties (target_id) where claimed_by is null;

create index if not exists family_bounties_family
  on public.family_bounties (family_id, expires_at);

-- ---------------------------------------------------------------------------
-- 2. leaving
-- ---------------------------------------------------------------------------

create or replace function public.get_leave_info()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  p       public.players;
  v_fam   public.families;
  v_role  text;
  v_fee   bigint;
  v_others int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.family_id is null then
    return jsonb_build_object('in_family', false);
  end if;

  select * into v_fam from public.families where id = p.family_id;
  select role into v_role from public.family_members
   where family_id = p.family_id and player_id = p.id;
  select count(*) - 1 into v_others from public.family_members where family_id = p.family_id;

  v_fee := least(5000000, greatest(25000,
             floor((coalesce(p.cash,0) + coalesce(p.personal_bank,0)) * 0.05)::bigint));

  return jsonb_build_object(
    'in_family', true,
    'family_name', v_fam.name,
    'family_tag', v_fam.tag,
    'my_role', v_role,
    'fee', v_fee,
    'can_afford', coalesce(p.cash,0) >= v_fee,
    'blocked_as_boss', v_role = 'boss' and v_others > 0,
    'others', v_others,
    'bounty_days', 7
  );
end;
$$;

-- Return type changes from boolean to jsonb, so the old one has to go first.
drop function if exists public.leave_family();

create or replace function public.leave_family()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_fam_id uuid;
  v_role   text;
  v_fee    bigint;
  v_others int;
  v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.family_id is null then raise exception 'NOT_IN_FAMILY'; end if;

  v_fam_id := p.family_id;

  select role into v_role from public.family_members
   where family_id = v_fam_id and player_id = p.id;
  select count(*) - 1 into v_others from public.family_members where family_id = v_fam_id;

  -- A boss can't abandon a crew that still has members: hand the seat over first.
  if v_role = 'boss' and v_others > 0 then
    raise exception 'BOSS_MUST_HAND_OVER';
  end if;

  v_fee := least(5000000, greatest(25000,
             floor((coalesce(p.cash,0) + coalesce(p.personal_bank,0)) * 0.05)::bigint));

  if coalesce(p.cash,0) < v_fee then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - v_fee, family_id = null where id = p.id;

  delete from public.family_members
   where family_id = v_fam_id and player_id = p.id;

  -- The last one out doesn't get hunted by an empty room.
  if v_others > 0 then
    v_expires := now() + interval '7 days';

    -- Any stale unclaimed bounty is replaced by this one.
    delete from public.family_bounties where target_id = p.id and claimed_by is null;

    insert into public.family_bounties (target_id, family_id, amount, expires_at)
    values (p.id, v_fam_id, v_fee, v_expires);

    perform public._log_event_named(
      p.username, 'bounty',
      'walked out on the family — ' || p.username || ' has a $' || v_fee || ' bounty on their head'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'fee', v_fee,
    'bounty_placed', v_others > 0,
    'bounty_amount', case when v_others > 0 then v_fee else 0 end,
    'expires_at', v_expires
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. claiming (automatic, on a successful rip or hit)
-- ---------------------------------------------------------------------------

create or replace function public._try_claim_bounty(p_attacker uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  b        record;
  v_att_fam uuid;
  v_att_name text;
  v_tgt_name text;
begin
  select family_id, username into v_att_fam, v_att_name
    from public.players where id = p_attacker;
  if v_att_fam is null then return null; end if;

  -- Only the crew they walked out on gets paid.
  select * into b from public.family_bounties
   where target_id = p_target
     and family_id = v_att_fam
     and claimed_by is null
     and expires_at > now()
   for update;

  if b.id is null then return null; end if;

  update public.family_bounties
     set claimed_by = p_attacker, claimed_at = now()
   where id = b.id;

  -- Blood money is dirty money (066).
  update public.players
     set dirty_cash = coalesce(dirty_cash, 0) + b.amount
   where id = p_attacker;

  select username into v_tgt_name from public.players where id = p_target;

  perform public._log_event_named(
    v_att_name, 'bounty',
    'collected the $' || b.amount || ' bounty on ' || coalesce(v_tgt_name, 'a traitor')
  );

  return jsonb_build_object('claimed', true, 'amount', b.amount, 'target', v_tgt_name);
end;
$$;

revoke all on function public._try_claim_bounty(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. read models
-- ---------------------------------------------------------------------------

-- Bounties my family can collect on.
create or replace function public.get_family_bounties()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_fam uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select family_id into v_fam from public.players where id = auth.uid();
  if v_fam is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'target', pl.username,
      'target_city', pl.current_city,
      'amount', b.amount,
      'created_at', b.created_at,
      'expires_at', b.expires_at,
      'claimed_by', cl.username,
      'claimed_at', b.claimed_at
    ) order by b.claimed_at nulls first, b.expires_at)
    from public.family_bounties b
    join public.players pl on pl.id = b.target_id
    left join public.players cl on cl.id = b.claimed_by
    where b.family_id = v_fam
      and (b.claimed_by is null and b.expires_at > now()
           or b.claimed_at > now() - interval '2 days')
  ), '[]'::jsonb);
end;
$$;

-- Is there a price on MY head?
create or replace function public.get_my_bounty()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  b record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select fb.*, f.name as family_name, f.tag as family_tag into b
    from public.family_bounties fb
    join public.families f on f.id = fb.family_id
   where fb.target_id = auth.uid()
     and fb.claimed_by is null
     and fb.expires_at > now()
   limit 1;

  if b.id is null then return jsonb_build_object('has_bounty', false); end if;

  return jsonb_build_object(
    'has_bounty', true,
    'amount', b.amount,
    'expires_at', b.expires_at,
    'family_name', b.family_name,
    'family_tag', b.family_tag
  );
end;
$$;

revoke all on function public.get_leave_info() from public, anon;
revoke all on function public.leave_family() from public, anon;
revoke all on function public.get_family_bounties() from public, anon;
revoke all on function public.get_my_bounty() from public, anon;
grant execute on function public.get_leave_info() to authenticated;
grant execute on function public.leave_family() to authenticated;
grant execute on function public.get_family_bounties() to authenticated;
grant execute on function public.get_my_bounty() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. wire the claim into the two ways you can hit someone
-- ---------------------------------------------------------------------------

-- rip_player: on a successful rip, an ex-family member collects the bounty.
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

  -- bodyguard absorbs the attempt (070)
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
    PERFORM public.log_event('rip', 'ripped ' || target.username || ' for $' || stolen || '!');
    -- 077: hunting down a deserter pays out
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

-- attempt_murder: same claim hook on a successful hit. Body is otherwise
-- identical to 076 (intel gate + bodyguards + stat edge).
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
  v_bounty jsonb;
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
    -- 077: the crew they deserted collects
    v_bounty := public._try_claim_bounty(attacker.id, target.id);
  end if;

  update public.detective_searches set expires_at = now() where id = v_intel.id;

  return jsonb_build_object(
    'success', succeeded,
    'stolen', coalesce(stolen, 0),
    'skill_gained', case when succeeded then skill_gain else 0 end,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'bounty', v_bounty,
    'player', to_jsonb(attacker)
  );
end;
$$;
