-- ============================================================
-- 020: Real commit_heist function + heist cooldown logic
-- ============================================================

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

  -- Jail check
  if p.jailed_until is not null and p.jailed_until > now() then
    raise exception 'IN_JAIL';
  end if;

  if p.level < h.min_level then
    raise exception 'LEVEL_TOO_LOW';
  end if;

  final_crew := least(greatest(crew_size, h.min_crew), 6);

  -- Cooldown check
  select available_at into existing_cd 
  from public.heist_cooldowns 
  where player_id = p.id and heist_key = h.key;

  if existing_cd is not null and existing_cd > now() then
    raise exception 'ON_COOLDOWN';
  end if;

  -- Rebirth cooldown bonus
  cooldown_mult := greatest(0.5, 1 - (p.rebirths * 0.1));

  -- Gear bonus (from heist_gear jsonb or protection)
  if p.heist_gear is not null then
    gear_bonus := (coalesce((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.8));
  else
    gear_bonus := (p.protection * 0.8);
  end if;

  -- Crew bonus
  crew_bonus := (final_crew - 1) * 7;

  base_success := h.base_success;
  total_success := least(0.92, base_success + (gear_bonus / 100) + (crew_bonus / 100) - (p.heat / 300.0));

  succeeded := random() < total_success;

  if succeeded then
    reward := ((h.min_reward + floor(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.4))::bigint;
    gained_xp := floor(h.xp * (1 + p.rebirths * 0.3));
    p.cash := p.cash + reward;
    heat_gain := 8;
  else
    gained_xp := floor(h.xp * 0.4);
    p.jailed_until := now() + make_interval(secs => h.jail_seconds);
    heat_gain := 20;
  end if;

  p.xp := p.xp + gained_xp;
  p.heat := least(100, p.heat + heat_gain);

  -- Level up (simplified)
  declare xp_needed bigint := p.level * 100;
  begin
    while p.xp >= xp_needed loop
      p.xp := p.xp - xp_needed;
      p.level := p.level + 1;
      xp_needed := p.level * 100;
    end loop;
  end;

  -- Set cooldown
  next_available := now() + make_interval(secs => floor(h.cooldown_seconds * cooldown_mult));
  insert into public.heist_cooldowns (player_id, heist_key, available_at)
  values (p.id, h.key, next_available)
  on conflict (player_id, heist_key) do update set available_at = excluded.available_at;

  update public.players
  set cash = p.cash, level = p.level, xp = p.xp, jailed_until = p.jailed_until, heat = p.heat
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

comment on function public.commit_heist(text, int) is 'Real heist execution with crew, gear, heat, cooldowns.';