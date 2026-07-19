-- 135_armory_weapons_vests.sql
-- Armory rebuild (Bulletstar "Wapen-power winkel" reference):
--   * armory_catalog: weapons + vests with a power stat (server-authoritative prices/stats)
--   * players.equipped_weapon / equipped_vest (one of each, buying replaces, no refund)
--   * commit_heist: weapon comes from equipment (client weapon param dropped)
--   * attempt_murder: weapon comes from equipment — closes the free "+20 Rifle" claim
--     (old function trusted a client-supplied weapon string without ownership check),
--     target's gear now defends, and the 076 detective-intel gate is RESTORED
--     (it had been lost from the live DB by an out-of-band overwrite).
--   * rip_player + attempt_murder: 077 bounty auto-claim hook RESTORED
--     (_try_claim_bounty had been orphaned by the same out-of-band overwrites).
--   * rip_player: gear edge for attacker weapon vs target weapon+vest
--   * players.weapons jsonb + buy_weapon + _weapon_bonus dropped (superseded)

-- ============================================================
-- Catalog
-- ============================================================
create table public.armory_catalog (
  key         text primary key,
  kind        text not null check (kind in ('weapon','vest')),
  label       text not null,
  price       bigint not null check (price >= 0),
  power       int not null default 0 check (power >= 0),
  heist_class text check (heist_class in ('pistol','smg','rifle')),
  min_level   int not null default 1,
  sort        int not null default 0
);

-- RPC-only, same pattern as car_catalog.
alter table public.armory_catalog enable row level security;

insert into public.armory_catalog (key, kind, label, price, power, heist_class, min_level, sort) values
  ('boxing_gloves',  'weapon', 'Boxing Gloves',       200,    0, null,     1, 10),
  ('glock17',        'weapon', 'Glock 17',           3500,   10, 'pistol', 1, 20),
  ('desert_eagle',   'weapon', 'Desert Eagle',       5500,   25, 'pistol', 4, 30),
  ('ak47',           'weapon', 'AK-47',             11000,   60, 'rifle',  8, 40),
  ('mp5k',           'weapon', 'MP5k',              23500,  145, 'smg',   12, 50),
  ('barrett_m82',    'weapon', 'Barrett M82',      150000,  400, 'rifle', 20, 60),
  ('padded_jacket',  'vest',   'Padded Jacket',      2000,    5, null,     1, 110),
  ('kevlar_vest',    'vest',   'Kevlar Vest',       12000,   35, null,     6, 120),
  ('tactical_vest',  'vest',   'Tactical Vest',     45000,  110, null,    12, 130),
  ('heavy_tactical', 'vest',   'Heavy Tactical Vest',150000, 260, null,   20, 140);

alter table public.players
  add column if not exists equipped_weapon text references public.armory_catalog(key),
  add column if not exists equipped_vest   text references public.armory_catalog(key);

-- Migrate legacy heist weapons (players.weapons jsonb) to the closest catalog gun.
update public.players
set equipped_weapon = case
  when coalesce(weapons, '[]'::jsonb) ? 'rifle'  then 'ak47'
  when coalesce(weapons, '[]'::jsonb) ? 'smg'    then 'mp5k'
  when coalesce(weapons, '[]'::jsonb) ? 'pistol' then 'glock17'
  else null
end
where jsonb_array_length(coalesce(weapons, '[]'::jsonb)) > 0;

alter table public.players drop column if exists weapons;
drop function if exists public.buy_weapon(text);
drop function if exists public._weapon_bonus(text);

-- ============================================================
-- get_armory / buy_armory_item
-- ============================================================
create or replace function public.get_armory()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.sort), '[]'::jsonb)
      from public.armory_catalog a
    ),
    'equipped_weapon', p.equipped_weapon,
    'equipped_vest',   p.equipped_vest
  );
end;
$$;

create or replace function public.buy_armory_item(item_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p    public.players;
  item public.armory_catalog;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into item from public.armory_catalog where key = item_key;
  if item.key is null then raise exception 'UNKNOWN_ITEM'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.level < item.min_level then raise exception 'LEVEL_TOO_LOW'; end if;

  if item.kind = 'weapon' and p.equipped_weapon = item.key then raise exception 'ALREADY_EQUIPPED'; end if;
  if item.kind = 'vest'   and p.equipped_vest   = item.key then raise exception 'ALREADY_EQUIPPED'; end if;

  if p.cash < item.price then raise exception 'NOT_ENOUGH_CASH'; end if;

  -- Buying replaces the current item of that kind. No trade-in (money sink).
  update public.players
  set cash = cash - item.price,
      equipped_weapon = case when item.kind = 'weapon' then item.key else equipped_weapon end,
      equipped_vest   = case when item.kind = 'vest'   then item.key else equipped_vest   end
  where id = p.id;

  select * into p from public.players where id = auth.uid();

  return jsonb_build_object(
    'success', true,
    'item', item.key,
    'kind', item.kind,
    'label', item.label,
    'charged', item.price,
    'player', to_jsonb(p)
  );
end;
$$;

revoke all on function public.get_armory() from public, anon;
grant execute on function public.get_armory() to authenticated;
revoke all on function public.buy_armory_item(text) from public, anon;
grant execute on function public.buy_armory_item(text) to authenticated;

-- ============================================================
-- commit_heist: weapon now comes from equipment
-- ============================================================
drop function if exists public.commit_heist(text, integer, integer, text, uuid);

create or replace function public.commit_heist(heist_key text, crew_size integer, bullets_used integer default 0, car_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  p public.players;
  h record;
  car public.player_cars;
  wpn public.armory_catalog;
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
  interval_sec int := public._action_interval_seconds();
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if car_id is null then raise exception 'CAR_REQUIRED'; end if;
  select * into h from public.heists where key = heist_key;
  if h.key is null then raise exception 'UNKNOWN_HEIST'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.last_action_at is not null and p.last_action_at > (now() - make_interval(secs => interval_sec)) then
    raise exception 'TOO_FAST';
  end if;

  -- A heist needs a real gun equipped (bought in the Armory). Boxing gloves won't do.
  select * into wpn from public.armory_catalog where key = p.equipped_weapon;
  if wpn.key is null or wpn.heist_class is null then raise exception 'WEAPON_REQUIRED'; end if;

  select * into car from public.player_cars where id = car_id and player_id = p.id for update;
  if car.id is null then raise exception 'CAR_NOT_OWNED'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;
  if p.jailed_until is not null and p.jailed_until > now() then raise exception 'IN_JAIL'; end if;
  if p.level < h.min_level then raise exception 'LEVEL_TOO_LOW'; end if;
  select available_at into existing_cd from public.heist_cooldowns where player_id = p.id and heist_key = h.key;
  if existing_cd is not null and existing_cd > now() then raise exception 'ON_COOLDOWN'; end if;
  p.stamina := public._spend_stamina(p.id, 15);
  final_crew := least(greatest(crew_size, 2), 3);
  bullets_spent := greatest(0, least(coalesce(bullets_used, 0), 500));
  if coalesce(p.bullets, 0) < bullets_spent then raise exception 'NOT_ENOUGH_BULLETS'; end if;
  bullet_bonus := least(15, bullets_spent / 10.0);
  weapon_bonus := least(20, wpn.power / 8.0);
  getaway_bonus := least(10, floor(car.condition / 12.0) + case when car.tuned then 2 else 0 end);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));
  if p.heist_gear is not null then
    gear_bonus := coalesce((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  else
    gear_bonus := p.protection * 0.6;
  end if;
  crew_bonus := (final_crew - 1) * 10;
  base_success := h.base_success;
  total_success := least(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100)
    + (bullet_bonus / 100) + (weapon_bonus / 100) + (getaway_bonus / 100) - (p.heat / 250.0));
  succeeded := random() < total_success;
  p.bullets := coalesce(p.bullets, 0) - bullets_spent;
  if succeeded then
    health_loss := 1 + random() * 2;
    reward := ((h.min_reward + floor(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := floor(h.xp * (1 + p.rebirths * 0.25));
    p.dirty_cash := coalesce(p.dirty_cash, 0) + reward;
    p.power := p.power + floor(reward / 20);
    perform public.record_hustler_progress('heist', 1);
    perform public.bump_player_stat('heist');
    heat_gain := 6;
  else
    health_loss := 5 + random() * 10;
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 18;
  end if;
  p.health := greatest(0, p.health - health_loss);
  if p.health <= 0 then
    p.death_until := now() + make_interval(secs => 3600);
    p.health := 0;
  end if;
  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);
  declare xp_needed bigint := p.level * 100;
  begin
    while p.xp >= xp_needed loop
      p.xp := p.xp - xp_needed; p.level := p.level + 1; xp_needed := p.level * 100;
    end loop;
  end;
  update public.player_cars set condition = greatest(0, condition - 8) where id = car.id;
  next_available := now() + make_interval(secs => floor(h.cooldown_seconds * cooldown_mult));
  insert into public.heist_cooldowns (player_id, heist_key, available_at)
  values (p.id, h.key, next_available)
  on conflict (player_id, heist_key) do update set available_at = excluded.available_at;
  update public.players set dirty_cash = p.dirty_cash, power = p.power, level = p.level, xp = p.xp,
    health = p.health, death_until = p.death_until, jailed_until = p.jailed_until,
    heat = p.heat, heat_updated_at = now(), bullets = p.bullets, last_action_at = now() where id = p.id;
  if succeeded then
    perform public.log_event('heist', 'pulled off the ' || replace(h.key, '_', ' ') || ' for $' || reward || '!');
    v_event := public._roll_random_event(p.id);
  end if;
  return jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'bullets_used', bullets_spent, 'weapon', wpn.key, 'weapon_bonus', weapon_bonus,
    'getaway_bonus', getaway_bonus, 'success_chance', round(total_success * 100),
    'available_at', next_available, 'stamina', p.stamina, 'event', v_event,
    'player', to_jsonb(p), 'health_lost', health_loss
  );
end;
$$;

revoke all on function public.commit_heist(text, integer, integer, uuid) from public, anon;
grant execute on function public.commit_heist(text, integer, integer, uuid) to authenticated;

-- ============================================================
-- attempt_murder: equipment-based, gear defense, intel gate restored
-- ============================================================
drop function if exists public.attempt_murder(text, text, integer);

create or replace function public.attempt_murder(target_username text, bullets_used integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  attacker public.players;
  target public.players;
  aw public.armory_catalog;
  tw public.armory_catalog;
  tv public.armory_catalog;
  intel public.detective_searches;
  attacker_level int;
  attacker_skill numeric;
  stat_edge numeric;
  gear_def numeric;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.05;
  heat_gain int := 20;
  cooldown_end timestamptz;
  v_bounty jsonb;
  interval_sec int := public._action_interval_seconds();
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into attacker from public.players where id = auth.uid() for update;
  if attacker.last_action_at is not null and attacker.last_action_at > (now() - make_interval(secs => interval_sec)) then
    raise exception 'TOO_FAST';
  end if;
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

  -- 076 intel gate (restored): a hit needs a warm detective report on this
  -- target, and the attacker must be in the target's city. Intel burns on use.
  select * into intel from public.detective_searches
  where player_id = attacker.id and target_id = target.id
    and delivered and expires_at > now()
  order by expires_at desc limit 1;
  if intel.id is null then raise exception 'NO_INTEL'; end if;
  if coalesce(attacker.current_city, '') is distinct from coalesce(target.current_city, '') then
    raise exception 'TARGET_MOVED';
  end if;
  update public.detective_searches set expires_at = now() where id = intel.id;

  attacker.stamina := public._spend_stamina(attacker.id, 15);
  attacker.bullets := greatest(0, coalesce(attacker.bullets, 0) - bullets_used);
  if coalesce(target.bodyguards, 0) > 0 then
    update public.players set bodyguards = bodyguards - 1 where id = target.id;
    attacker.heat := least(100, coalesce(attacker.heat, 0) + 10);
    cooldown_end := now() + interval '65 minutes';
    attacker.murder_cooldown := cooldown_end;
    attacker.last_action_at := now();
    update public.players set
      heat = attacker.heat, heat_updated_at = now(),
      bullets = attacker.bullets, murder_cooldown = attacker.murder_cooldown,
      last_action_at = attacker.last_action_at
    where id = attacker.id;
    return jsonb_build_object(
      'success', false, 'blocked', true, 'stolen', 0,
      'guards_left', coalesce(target.bodyguards, 0) - 1,
      'cooldown_until', cooldown_end, 'stamina', attacker.stamina,
      'player', to_jsonb(attacker)
    );
  end if;

  -- Attacker's gun helps; the victim's gun + vest defend (Bulletstar-style).
  select * into aw from public.armory_catalog where key = attacker.equipped_weapon;
  select * into tw from public.armory_catalog where key = target.equipped_weapon;
  select * into tv from public.armory_catalog where key = target.equipped_vest;

  success_chance := least(90, greatest(10, attacker_skill * 5));
  if attacker_skill >= 15 then success_chance := success_chance + 15; end if;
  success_chance := success_chance + least(20, coalesce(aw.power, 0) / 8.0);
  gear_def := least(25, (coalesce(tw.power, 0) + coalesce(tv.power, 0)) / 12.0);
  success_chance := success_chance - gear_def;
  success_chance := success_chance + least(20, bullets_used / 25);
  stat_edge := least(15, greatest(-15, (coalesce(attacker.strength, 10) - coalesce(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;
  succeeded := random() < (success_chance / 100);
  if succeeded then
    stolen := floor(target.cash * 0.2);
    attacker.dirty_cash := coalesce(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := coalesce(attacker.murder_skill, 0) + skill_gain;
    perform public.record_hustler_progress('murder', 1);
    perform public.bump_player_stat('murder');
    v_bounty := public._try_claim_bounty(attacker.id, target.id);
    heat_gain := 15;
  else
    attacker.heat := least(100, coalesce(attacker.heat, 0) + heat_gain + 10);
  end if;
  attacker.heat := least(100, coalesce(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '65 minutes';
  attacker.murder_cooldown := cooldown_end;
  attacker.last_action_at := now();
  update public.players set
    dirty_cash = attacker.dirty_cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
    heat_updated_at = now(),
    bullets = attacker.bullets,
    murder_cooldown = attacker.murder_cooldown,
    last_action_at = attacker.last_action_at
  where id = attacker.id;
  if succeeded then
    target.cash := greatest(0, target.cash - stolen);
    update public.players set cash = target.cash where id = target.id;
  end if;
  return jsonb_build_object(
    'success', succeeded,
    'stolen', coalesce(stolen, 0),
    'skill_gained', case when succeeded then skill_gain else 0 end,
    'gear_def', gear_def,
    'bounty', v_bounty,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
end;
$$;

revoke all on function public.attempt_murder(text, integer) from public, anon;
grant execute on function public.attempt_murder(text, integer) to authenticated;

-- ============================================================
-- rip_player: gear edge
-- ============================================================
create or replace function public.rip_player(target_username text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  attacker public.players;
  target   public.players;
  aw public.armory_catalog;
  tw public.armory_catalog;
  tv public.armory_catalog;
  cd timestamptz;
  lvl_diff int;
  stat_edge numeric;
  gear_edge numeric;
  success_chance numeric;
  succeeded boolean;
  pct numeric;
  stolen bigint := 0;
  v_bounty jsonb;
  interval_sec int := public._action_interval_seconds();
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into attacker from public.players where id = auth.uid() for update;
  if attacker.id is null then raise exception 'NO_PLAYER'; end if;
  if attacker.last_action_at is not null and attacker.last_action_at > (now() - make_interval(secs => interval_sec)) then
    raise exception 'TOO_FAST';
  end if;
  if attacker.death_until is not null and attacker.death_until > now() then raise exception 'DEAD'; end if;
  if attacker.jailed_until is not null and attacker.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  select * into target from public.players where username = target_username for update;
  if target.id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if target.id = attacker.id then raise exception 'CANNOT_TARGET_SELF'; end if;
  if target.death_until is not null and target.death_until > now() then raise exception 'TARGET_DEAD'; end if;
  if target.kill_protected_until is not null and target.kill_protected_until > now() then raise exception 'TARGET_PROTECTED'; end if;
  if coalesce(target.cash, 0) < 100 then raise exception 'TARGET_NO_CASH'; end if;

  select available_at into cd from public.rip_cooldowns
   where attacker_id = attacker.id and target_id = target.id;
  if cd is not null and cd > now() then raise exception 'ON_COOLDOWN'; end if;

  attacker.stamina := public._spend_stamina(attacker.id, 10);

  insert into public.rip_cooldowns (attacker_id, target_id, available_at)
  values (attacker.id, target.id, now() + interval '4 seconds')
  on conflict (attacker_id, target_id) do update set available_at = excluded.available_at;

  if coalesce(target.bodyguards, 0) > 0 then
    update public.players set bodyguards = bodyguards - 1 where id = target.id;
    attacker.heat := least(100, coalesce(attacker.heat, 0) + 3);
    attacker.last_action_at := now();
    update public.players set heat = attacker.heat, heat_updated_at = now(), last_action_at = attacker.last_action_at where id = attacker.id;
    return jsonb_build_object(
      'success', false, 'blocked', true, 'target', target.username,
      'guards_left', coalesce(target.bodyguards, 0) - 1,
      'new_heat', attacker.heat, 'stamina', attacker.stamina
    );
  end if;

  select * into aw from public.armory_catalog where key = attacker.equipped_weapon;
  select * into tw from public.armory_catalog where key = target.equipped_weapon;
  select * into tv from public.armory_catalog where key = target.equipped_vest;

  lvl_diff := coalesce(attacker.level, 1) - coalesce(target.level, 1);
  stat_edge := least(15, greatest(-15, (coalesce(attacker.strength, 10) - coalesce(target.defense, 10)) / 2.0));
  gear_edge := least(10, coalesce(aw.power, 0) / 15.0) - least(10, (coalesce(tw.power, 0) + coalesce(tv.power, 0)) / 20.0);
  success_chance := least(90, greatest(20, 60 + lvl_diff * 3 + stat_edge + gear_edge));
  succeeded := random() < (success_chance / 100.0);

  if succeeded then
    pct := 0.10 + random() * 0.10;
    stolen := greatest(1, floor(target.cash * pct));
    attacker.heat := least(100, coalesce(attacker.heat, 0) + 5);
    update public.players set cash = greatest(0, cash - stolen) where id = target.id;
    update public.players
       set dirty_cash = coalesce(dirty_cash, 0) + stolen,
           heat = attacker.heat, heat_updated_at = now(), last_action_at = now()
     where id = attacker.id;
    perform public.log_event('rip', 'ripped ' || target.username || ' for $' || stolen || '!');
    v_bounty := public._try_claim_bounty(attacker.id, target.id);
  else
    attacker.heat := least(100, coalesce(attacker.heat, 0) + 15);
    attacker.last_action_at := now();
    update public.players set heat = attacker.heat, heat_updated_at = now(), last_action_at = attacker.last_action_at where id = attacker.id;
  end if;

  return jsonb_build_object(
    'success', succeeded, 'stolen', stolen, 'target', target.username,
    'success_chance', round(success_chance),
    'new_dirty', coalesce(attacker.dirty_cash, 0) + case when succeeded then stolen else 0 end,
    'new_heat', attacker.heat, 'stamina', attacker.stamina, 'bounty', v_bounty
  );
end;
$$;
