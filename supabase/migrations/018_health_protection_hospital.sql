-- ============================================================
-- 018: Health system, Protection from gear, Hospital healing
-- Health decreases on every crime (higher risk = more damage)
-- Protection reduces health loss
-- Hospital sells health restoration
-- ============================================================

-- 1) Make sure protection column exists on players (for body armor etc.)
alter table public.players
  add column if not exists protection int not null default 0;

-- 2) Update commit_crime to deduct health based on risk
-- Higher risk crimes hurt more. Fail = extra damage.
-- Protection reduces the final health loss.
create or replace function public.commit_crime(crime_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into c from public.crimes where key = commit_crime.crime_key;
  if c.key is null then
    raise exception 'UNKNOWN_CRIME';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;

  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;

  if p.level < c.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  -- Cooldown
  select available_at into existing_cd 
  from public.crime_cooldowns 
  where player_id = p.id and crime_key = c.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

  mult := 1 + (p.rebirths * 0.5);
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  succeeded := random() < c.success_chance;

  -- Calculate base health loss based on crime risk
  -- Low risk jobs = small loss, high risk = big loss
  case c.key
    when 'pickpocket' then risk_multiplier := 1.0;   -- very low
    when 'rob_store'  then risk_multiplier := 2.5;
    when 'steal_car'  then risk_multiplier := 4.0;
    when 'warehouse_heist' then risk_multiplier := 8.0;  -- renamed bank heist
    when 'train_murder' then risk_multiplier := 7.0;     -- high risk training
    else risk_multiplier := 3.0;
  end case;

  health_loss := ceil(2 * risk_multiplier);  -- base 2-16 depending on job

  if not succeeded then
    health_loss := health_loss + ceil(4 * risk_multiplier);  -- fail hurts more
  end if;

  -- Apply protection (reduces loss, but not below 1)
  final_loss := greatest(1, health_loss - floor(p.protection * 0.4));

  -- Apply health loss
  p.health := greatest(0, p.health - final_loss);

  if succeeded then
    reward := ((c.min_reward + floor(random() * (c.max_reward - c.min_reward + 1))) * mult)::bigint;
    gained_xp := floor(c.xp_success * mult);
    p.cash := p.cash + reward;
    p.crimes_succeeded := p.crimes_succeeded + 1;

    if c.key = 'train_murder' then
      murder_gain := 0.02;
      p.murder_skill := p.murder_skill + murder_gain;
      heat_gain := 15;
    else
      heat_gain := 3;
    end if;
  else
    gained_xp := floor(c.xp_success * mult / 2);
    p.crimes_failed := p.crimes_failed + 1;

    if c.key = 'train_murder' then
      p.jailed_until := now() + make_interval(secs => 300); -- 5 min
      heat_gain := 25;
    else
      p.jailed_until := now() + make_interval(secs => c.jail_seconds);
      heat_gain := 12;
    end if;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Police chance
  if p.heat > 25 then
    police_roll := random();
    if police_roll < (p.heat / 180.0) then
      extra_jail := floor(300 + random() * 600);
      p.jailed_until := greatest(p.jailed_until, now() + make_interval(secs => extra_jail));
    end if;
  end if;

  -- Level up
  xp_needed := p.level * 100;
  while p.xp >= xp_needed loop
    p.xp := p.xp - xp_needed;
    p.level := p.level + 1;
    leveled_up := true;
    xp_needed := p.level * 100;
  end loop;

  -- Cooldown
  next_available := now() + make_interval(secs => floor(c.cooldown_seconds * cooldown_mult));
  insert into public.crime_cooldowns (player_id, crime_key, available_at)
  values (p.id, c.key, next_available)
  on conflict (player_id, crime_key) do update set available_at = excluded.available_at;

  update public.players
  set
    cash = p.cash,
    level = p.level,
    xp = p.xp,
    health = p.health,
    jailed_until = p.jailed_until,
    heat = p.heat,
    murder_skill = p.murder_skill,
    crimes_succeeded = p.crimes_succeeded,
    crimes_failed = p.crimes_failed
  where id = p.id;

  return jsonb_build_object(
    'success', succeeded,
    'reward', reward,
    'xp_gained', gained_xp,
    'leveled_up', leveled_up,
    'available_at', next_available,
    'murder_skill_gained', murder_gain,
    'health_lost', final_loss,
    'player', to_jsonb(p)
  );
end;
$$;

-- 3) Hospital healing function
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
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if amount not in (10, 25, 50, 100) then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  -- Pricing: cheap for small, expensive for full
  case amount
    when 10 then cost := 150;
    when 25 then cost := 350;
    when 50 then cost := 650;
    when 100 then cost := 1200;
  end case;

  if p.cash < cost then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  heal_amount := amount;
  p.cash := p.cash - cost;
  p.health := least(100, p.health + heal_amount);

  update public.players set cash = p.cash, health = p.health where id = p.id;

  return jsonb_build_object('player', to_jsonb(p), 'healed', heal_amount);
end;
$$;

-- 4) Protection purchase helper (used by shop/armory)
-- This increases the protection stat (reduces future health loss)
create or replace function public.buy_protection(protection_points int, cost bigint)
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

  if p.cash < cost then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  p.cash := p.cash - cost;
  p.protection := least(50, p.protection + protection_points);  -- cap at 50 for balance

  update public.players set cash = p.cash, protection = p.protection where id = p.id;

  return jsonb_build_object('player', to_jsonb(p));
end;
$$;

comment on column public.players.health is 'Current health (0-100). Decreases with every crime. 0 = very bad.';
comment on column public.players.protection is 'Reduces health loss from crimes/heists. Bought in weapon shop/armory.';
comment on function public.buy_health(int) is 'Hospital function: buy health restoration.';
comment on function public.buy_protection(int, bigint) is 'Buy protection items (body armor, pitbull, bodyguard).';