-- 136_powerrip_leaderboard.sql
-- Powerrip kill-score leaderboard (Bulletstar "Moord Lijst" / Powerrip systeem geld.txt):
--   Rip Points = (Base Rank Power + Weapon Def + Vest Def) x (1 + victim_bullets / 1000)
--   where Base Rank Power = victim_level * 10 and weapon/vest def come from the
--   victim's equipped armory gear (135). Scored on a SUCCESSFUL murder only —
--   killing an unarmed low-level yields ~level*10, hunting an armed tank pays big.
--   * players.rip_points counter
--   * attempt_murder: computes + awards the score (full replace of the 135 body)
--   * get_rip_leaderboard(limit)
--   * get_public_profile: shows equipped gear labels + gear power + rip points,
--     so hunters can scout how "valuable" a target is (the defense trap).

alter table public.players add column if not exists rip_points bigint not null default 0;

-- ============================================================
-- attempt_murder with Powerrip scoring (supersedes the 135 body)
-- ============================================================
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
  rip_score bigint := 0;
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

  -- 076 intel gate: warm detective report + same city. Intel burns on use.
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
    -- Powerrip: score the VICTIM's combat worth at the moment of the hit.
    rip_score := round(
      (coalesce(target.level, 1) * 10 + coalesce(tw.power, 0) + coalesce(tv.power, 0))
      * (1 + coalesce(target.bullets, 0) / 1000.0)
    );
    attacker.rip_points := coalesce(attacker.rip_points, 0) + rip_score;
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
    rip_points = attacker.rip_points,
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
    'rip_score', rip_score,
    'bounty', v_bounty,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
end;
$$;

-- ============================================================
-- Leaderboard
-- ============================================================
create or replace function public.get_rip_leaderboard(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  return coalesce((
    select jsonb_agg(row order by (row->>'rip_points')::bigint desc)
    from (
      select jsonb_build_object(
        'username', p.username,
        'level', p.level,
        'rip_points', p.rip_points,
        'is_donator', p.is_donator,
        'family_tag', f.tag
      ) as row
      from public.players p
      left join public.families f on f.id = p.family_id
      where p.rip_points > 0
      order by p.rip_points desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) sub
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_rip_leaderboard(integer) from public, anon;
grant execute on function public.get_rip_leaderboard(integer) to authenticated;

-- ============================================================
-- Public profile: scoutable gear (the "defense trap" mechanic)
-- ============================================================
create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'level', p.level,
    'is_donator', p.is_donator,
    'crimes_succeeded', p.crimes_succeeded, 'crimes_failed', p.crimes_failed,
    'family_id', p.family_id, 'power', p.power, 'protection', p.protection,
    'health', p.health, 'murder_skill', p.murder_skill,
    'avatar_url', p.avatar_url, 'bio', p.bio,
    'created_at', p.created_at, 'last_active', p.last_active,
    'rebirths', p.rebirths,
    'family_name', f.name, 'family_tag', f.tag,
    'equipped_weapon', w.label, 'equipped_vest', v.label,
    'gear_power', coalesce(w.power, 0) + coalesce(v.power, 0),
    'rip_points', p.rip_points
  ) into result
  from public.players p
  left join public.families f on f.id = p.family_id
  left join public.armory_catalog w on w.key = p.equipped_weapon
  left join public.armory_catalog v on v.key = p.equipped_vest
  where p.username ilike p_username
  limit 1;

  if result is null then raise exception 'PLAYER_NOT_FOUND'; end if;
  return result;
end;
$$;
