-- Update health deduction for heists and hits: 5-15% on fail, less on success.

-- Update attempt_hit to deduct health
CREATE OR REPLACE FUNCTION public.attempt_hit(target_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF attacker.kill_protected_until IS NOT NULL AND attacker.kill_protected_until > now() THEN
    RAISE EXCEPTION 'KILL_PROTECTED';
  END IF;

  -- Success based on murder_skill
  success_chance := LEAST(0.85, GREATEST(0.15, (attacker.murder_skill + 5) / (target.level + 10) * 0.6 ));
  succeeded := random() < success_chance;

  -- Health deduction 5-15% on fail, 2-5% on success (scaled)
  IF succeeded THEN
    health_loss := 2 + random() * 3;  -- ~2-5%
    stolen := FLOOR(target.cash * 0.15 + random() * 200);
    IF stolen > target.cash THEN stolen := target.cash; END IF;

    attacker.cash := attacker.cash + stolen;
    attacker.murder_skill := attacker.murder_skill + skill_gain;
    attacker.heat := LEAST(100, attacker.heat + 15);

    target.cash := target.cash - stolen;
    target.heat := LEAST(100, target.heat + 10);

    UPDATE public.players SET cash = attacker.cash, murder_skill = attacker.murder_skill, heat = attacker.heat WHERE id = attacker.id;
    UPDATE public.players SET cash = target.cash, heat = target.heat WHERE id = target.id;

    RETURN jsonb_build_object('success', true, 'stolen', stolen, 'skill_gained', skill_gain, 'player', to_jsonb(attacker));
  ELSE
    health_loss := 5 + random() * 10;  -- 5-15%
    attacker.health := GREATEST(0, attacker.health - health_loss);
    attacker.heat := LEAST(100, attacker.heat + 25);
    
    IF attacker.health <= 0 THEN
      attacker.death_until := now() + make_interval(secs => 3600);
      attacker.kill_protected_until := null; -- reset on death
    END IF;

    attacker.jailed_until := now() + make_interval(secs => 300);

    UPDATE public.players SET health = attacker.health, death_until = attacker.death_until, heat = attacker.heat, jailed_until = attacker.jailed_until WHERE id = attacker.id;

    RETURN jsonb_build_object('success', false, 'jail_time', 300, 'health_lost', health_loss, 'player', to_jsonb(attacker));
  END IF;
END;
$$;

-- Update commit_heist for health deduction on fail 5-15%
CREATE OR REPLACE FUNCTION public.commit_heist(heist_key text, crew_size int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
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
  health_loss numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO h FROM public.heists WHERE key = heist_key;
  IF h.key IS NULL THEN RAISE EXCEPTION 'UNKNOWN_HEIST'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF p.level < h.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;

  final_crew := LEAST(GREATEST(crew_size, 2), 3);

  SELECT available_at INTO existing_cd FROM public.heist_cooldowns WHERE player_id = p.id AND heist_key = h.key;
  IF existing_cd IS NOT NULL AND existing_cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;

  cooldown_mult := GREATEST(0.5, 1 - (p.rebirths * 0.1));
  IF p.heist_gear IS NOT NULL THEN
    gear_bonus := COALESCE((p.heist_gear->>'bonus')::numeric, 0) + (p.protection * 0.6);
  ELSE
    gear_bonus := p.protection * 0.6;
  END IF;

  crew_bonus := (final_crew - 1) * 10;
  base_success := h.base_success;
  total_success := LEAST(0.90, base_success + (gear_bonus / 100) + (crew_bonus / 100) - (p.heat / 250.0));

  succeeded := random() < total_success;

  -- Health loss 5-15% on fail
  IF succeeded THEN
    health_loss := 1 + random() * 2; -- small on success
    reward := ((h.min_reward + FLOOR(random() * (h.max_reward - h.min_reward + 1))) * (1 + p.rebirths * 0.35))::bigint;
    gained_xp := FLOOR(h.xp * (1 + p.rebirths * 0.25));
    p.cash := p.cash + reward;
    p.power := p.power + FLOOR(reward / 20);
    heat_gain := 6;
  ELSE
    health_loss := 5 + random() * 10; -- 5-15%
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
      p.xp := p.xp - xp_needed;
      p.level := p.level + 1;
      xp_needed := p.level * 100;
    END LOOP;
  END;

  next_available := now() + make_interval(secs => FLOOR(h.cooldown_seconds * cooldown_mult));
  INSERT INTO public.heist_cooldowns (player_id, heist_key, available_at)
  VALUES (p.id, h.key, next_available)
  ON CONFLICT (player_id, heist_key) DO UPDATE SET available_at = excluded.available_at;

  UPDATE public.players SET cash = p.cash, power = p.power, level = p.level, xp = p.xp, health = p.health, death_until = p.death_until, jailed_until = p.jailed_until, heat = p.heat WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', succeeded, 'reward', reward, 'xp_gained', gained_xp, 'crew_used', final_crew,
    'success_chance', ROUND(total_success * 100), 'available_at', next_available, 'player', to_jsonb(p), 'health_lost', health_loss
  );
END;
$$;