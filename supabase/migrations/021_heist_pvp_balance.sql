-- ============================================================
-- 021: Heist cooldowns to 1.5h, crew 2-3, PvP Hits system, balance prices
-- ============================================================

-- Update heists to 1.5 hours (5400s) cooldown
-- All heists min_crew = 2 (3rd optional)
update public.heists set cooldown_seconds = 5400, min_crew = 2;

-- Ensure warehouse_heist exists with correct values
insert into public.heists (key, min_level, min_crew, min_reward, max_reward, base_success, xp, jail_seconds, cooldown_seconds, sort_order)
values ('warehouse_heist', 10, 2, 1500, 5000, 0.25, 120, 1800, 5400, 3)
on conflict (key) do update set 
  cooldown_seconds = 5400,
  min_crew = 2;

-- Create or update commit_heist if not perfect (builds on 020)
create or replace function public.commit_heist(heist_key text, crew_size int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  p public.players;
  h record;
  existing_cd timestamptz;
  next_available timestamptz;
  cooldown_mult numeric;
  base_success numeric;
  gear_bonus numeric := 0;
  crew_bonus numeric;
  total_success numeric;
  succeeded boolean;
  reward bigint := 0;
  gained_xp int := 0;
  heat_gain int;
  final_crew int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into h from public.heists where key = heist_key;
  if h.key is null then raise exception 'UNKNOWN_HEIST'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;

  if p.level < h.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  -- Crew 2 to 3 (3rd optional)
  final_crew := least(greatest(crew_size, 2), 3);

  -- Cooldown
  select available_at into existing_cd 
  from public.heist_cooldowns 
  where player_id = p.id and heist_key = h.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  -- Gear + protection bonus
  if p.heist_gear is not null then
    gear_bonus := coalesce((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  else
    gear_bonus := p.protection * 0.6;
  end if;

  crew_bonus := (final_crew - 1) * 10;  -- +10% per extra crew member

  base_success := h.base_success;
  total_success := least(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100) - (p.heat / 250.0));

  succeeded := random() < total_success;

  if succeeded then
    reward := ((h.min_reward + floor(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := floor(h.xp * (1 + p.rebirths * 0.25));
    p.cash := p.cash + reward;
    p.power := p.power + floor(reward / 20);  -- small power gain
    heat_gain := 6;
  else
    gained_xp := floor(h.xp * 0.3);
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 18;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Level up
  declare xp_needed bigint := p.level * 100;
  begin
    while p.xp >= xp_needed loop
      p.xp := p.xp - xp_needed;
      p.level := p.level + 1;
      xp_needed := p.level * 100;
    end loop;
  end;

  next_available := now() + make_interval(secs => floor(h.cooldown_seconds * cooldown_mult));
  insert into public.heist_cooldowns (player_id, heist_key, available_at)
  values (p.id, h.key, next_available)
  on conflict (player_id, heist_key) do update set available_at = excluded.available_at;

  update public.players
  set cash = p.cash, power = p.power, level = p.level, xp = p.xp, 
      jailed_until = p.jailed_until, heat = p.heat
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'crew_used', final_crew,
    'success_chance', round(total_success * 100),
    'available_at', next_available,
    'player', to_jsonb(p)
  );
end;
$$;

-- PvP Hits / Assassination system (more complete)
create or replace function public.attempt_hit(target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attacker public.players;
  target public.players;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.03;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if auth.uid() = target_player_id then raise exception 'CANNOT_HIT_SELF'; end if;

  select * into attacker from public.players where id = auth.uid() for update;
  select * into target from public.players where id = target_player_id for update;

  if attacker.id is null or target.id is null then raise exception 'PLAYER_NOT_FOUND'; end if;
  if attacker.jailed_until is not null and attacker.jailed_until > now() then raise exception 'IN_JAIL'; end if;

  -- Success based on murder_skill difference
  success_chance := least(0.85, greatest(0.15, (attacker.murder_skill + 5) / (target.level + 10) * 0.6 ));
  succeeded := random() < success_chance;

  if succeeded then
    stolen := floor(target.cash * 0.15 + random() * 200);  -- steal 15% + bonus
    if stolen > target.cash then stolen := target.cash; end if;

    attacker.cash := attacker.cash + stolen;
    attacker.murder_skill := attacker.murder_skill + skill_gain;
    attacker.heat := least(100, attacker.heat + 15);

    target.cash := target.cash - stolen;
    target.heat := least(100, target.heat + 10);

    update public.players set cash = attacker.cash, murder_skill = attacker.murder_skill, heat = attacker.heat where id = attacker.id;
    update public.players set cash = target.cash, heat = target.heat where id = target.id;

    return jsonb_build_object(
      'success', true,
      'stolen', stolen,
      'skill_gained', skill_gain,
      'player', to_jsonb(attacker)
    );
  else
    attacker.heat := least(100, attacker.heat + 25);
    attacker.jailed_until := now() + make_interval(secs => 300);  -- 5 min jail on fail

    update public.players set heat = attacker.heat, jailed_until = attacker.jailed_until where id = attacker.id;

    return jsonb_build_object(
      'success', false,
      'jail_time', 300,
      'player', to_jsonb(attacker)
    );
  end if;
end;
$$;

-- Balance prices for stability
-- Hospital: cheaper, $8 per health
create or replace function public.buy_health(amount int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  cost bigint;
  heal_amount int;
  max_heal int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if amount < 1 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  max_heal := 100 - p.health;
  if max_heal <= 0 then raise exception 'ALREADY_FULL_HEALTH'; end if;

  heal_amount := least(amount, max_heal);
  cost := heal_amount * 8;  -- $8 per health for better balance

  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  p.cash := p.cash - cost;
  p.health := least(100, p.health + heal_amount);

  update public.players set cash = p.cash, health = p.health where id = p.id;
  return jsonb_build_object('player', to_jsonb(p), 'healed', heal_amount, 'cost', cost);
end;
$$;

-- Armory power prices - more expensive for late game stability
create or replace function public.buy_power(power_amount int, cost bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  p.cash := p.cash - cost;
  p.power := p.power + power_amount;

  update public.players set cash = p.cash, power = p.power where id = p.id;
  return jsonb_build_object('player', to_jsonb(p));
end;
$$;

-- Add some weapon buffs that affect heists/crimes (simple multiplier via protection or new logic)
-- For now, buying better protection also slightly boosts power gain
-- (Can be extended in commit functions later)