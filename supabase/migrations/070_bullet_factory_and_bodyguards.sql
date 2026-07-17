-- 070_bullet_factory_and_bodyguards.sql
-- =====================================================================
-- SPOOR D2 — BULLET FACTORY ECONOMY + PERSONAL BODYGUARDS
-- ---------------------------------------------------------------------
-- Bullet Factory (classic mafia model, 25k cap per the crime-agent spec):
--   * Shared singleton stock (public.bullet_factory) with a 25,000 cap,
--     refilling lazily at 2,500/hour (remainder-preserving anchor).
--   * buy_bullets now sells from live stock: you can't buy more than the
--     factory holds, and the unit price scales with scarcity —
--     $3/bullet at full stock up to $10/bullet when nearly empty.
--   * The existing police-bust rule (buying > 5000 at once) is kept.
--   * get_bullet_factory() feeds the Metal Factory UI.
-- Personal bodyguards (players.bodyguards, max 5, escalating price):
--   * hire_personal_bodyguard() — $50k/$100k/$200k/$350k/$500k.
--   * A guard absorbs an incoming rip_player or attempt_murder: the
--     guard is lost, the attacker gets nothing (blocked: true payload).
--     Attacker still pays stamina/bullets — draining someone's guards
--     is intentionally expensive. Blocked murders get a 10-minute
--     cooldown instead of the full hour.
-- =====================================================================

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS bodyguards int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.bullet_factory (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stock int NOT NULL DEFAULT 25000,
  capacity int NOT NULL DEFAULT 25000,
  refill_per_hour int NOT NULL DEFAULT 2500,
  stock_updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bullet_factory (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
-- RLS on, no policies: only reachable via the DEFINER RPCs below.
ALTER TABLE public.bullet_factory ENABLE ROW LEVEL SECURITY;

-- ---------- internal: lock + lazy refill, returns the fresh row ----------
CREATE OR REPLACE FUNCTION public._factory_refill()
RETURNS public.bullet_factory LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  f public.bullet_factory;
  elapsed_h numeric;
  pts int;
BEGIN
  SELECT * INTO f FROM public.bullet_factory WHERE id = 1 FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'FACTORY_MISSING'; END IF;

  IF f.stock < f.capacity THEN
    elapsed_h := EXTRACT(EPOCH FROM (now() - f.stock_updated_at)) / 3600.0;
    pts := floor(elapsed_h * f.refill_per_hour)::int;
    IF pts > 0 THEN
      IF f.stock + pts >= f.capacity THEN
        f.stock := f.capacity;
        f.stock_updated_at := now();
      ELSE
        f.stock := f.stock + pts;
        -- advance the anchor only by the whole bullets produced (keep remainder)
        f.stock_updated_at := f.stock_updated_at
          + make_interval(secs => floor((pts::numeric / f.refill_per_hour) * 3600));
      END IF;
      UPDATE public.bullet_factory
         SET stock = f.stock, stock_updated_at = f.stock_updated_at
       WHERE id = 1;
    END IF;
  ELSE
    UPDATE public.bullet_factory SET stock_updated_at = now() WHERE id = 1;
    f.stock_updated_at := now();
  END IF;

  RETURN f;
END;
$$;

REVOKE ALL ON FUNCTION public._factory_refill() FROM public, anon, authenticated;

-- ---------- scarcity price helper: $3 full .. $10 empty ----------
CREATE OR REPLACE FUNCTION public._bullet_price(p_stock int, p_capacity int)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT 3 + ceil(7.0 * (1 - p_stock::numeric / GREATEST(1, p_capacity)))::int;
$$;

-- ---------- buy_bullets: sell from live stock at scarcity price ----------
CREATE OR REPLACE FUNCTION public.buy_bullets(amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  f public.bullet_factory;
  unit_price int;
  bought int;
  total_cost bigint;
  fine bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount < 10 THEN RAISE EXCEPTION 'MIN_10_BULLETS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF amount > 5000 THEN
    -- Police bust: fine, heat, confiscation (unchanged from 035)
    fine := floor(amount * 0.8)::bigint;
    UPDATE public.players
    SET cash = GREATEST(0, cash - fine),
        heat = LEAST(100, COALESCE(heat, 0) + 30),
        heat_updated_at = now(),
        bullets = GREATEST(0, COALESCE(bullets, 0) - floor(amount * 0.6)::bigint)
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'busted', true, 'fine', fine);
  END IF;

  f := public._factory_refill();
  IF f.stock <= 0 THEN RAISE EXCEPTION 'FACTORY_EMPTY'; END IF;

  bought := LEAST(amount, f.stock);
  unit_price := public._bullet_price(f.stock, f.capacity);
  total_cost := bought::bigint * unit_price;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      bullets = COALESCE(bullets, 0) + bought
  WHERE id = p.id;

  UPDATE public.bullet_factory SET stock = stock - bought WHERE id = 1;

  RETURN jsonb_build_object(
    'success', true, 'bullets_bought', bought, 'requested', amount,
    'unit_price', unit_price, 'cost', total_cost, 'stock_left', f.stock - bought
  );
END;
$$;

-- ---------- factory status for the UI ----------
CREATE OR REPLACE FUNCTION public.get_bullet_factory()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  f public.bullet_factory;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  f := public._factory_refill();
  RETURN jsonb_build_object(
    'stock', f.stock, 'capacity', f.capacity,
    'unit_price', public._bullet_price(f.stock, f.capacity),
    'refill_per_hour', f.refill_per_hour
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bullet_factory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_bullet_factory() TO authenticated;

-- ---------- hire_personal_bodyguard: escalating price, max 5 ----------
CREATE OR REPLACE FUNCTION public.hire_personal_bodyguard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  guards int;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  guards := COALESCE(p.bodyguards, 0);
  IF guards >= 5 THEN RAISE EXCEPTION 'MAX_BODYGUARDS'; END IF;

  cost := CASE guards + 1
    WHEN 1 THEN 50000
    WHEN 2 THEN 100000
    WHEN 3 THEN 200000
    WHEN 4 THEN 350000
    ELSE 500000
  END;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - cost, bodyguards = guards + 1
  WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', true, 'bodyguards', guards + 1, 'cost', cost,
    'next_cost', CASE guards + 2
      WHEN 2 THEN 100000 WHEN 3 THEN 200000 WHEN 4 THEN 350000 WHEN 5 THEN 500000
      ELSE NULL END,
    'new_cash', p.cash - cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hire_personal_bodyguard() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hire_personal_bodyguard() TO authenticated;

-- =====================================================================
-- PVP SWEEP: bodyguards absorb rip / murder attempts
-- =====================================================================

-- ---------- rip_player: guard absorbs the attempt ----------
CREATE OR REPLACE FUNCTION public.rip_player(target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
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
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 15);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded, 'stolen', stolen, 'target', target.username,
    'success_chance', ROUND(success_chance),
    'new_dirty', COALESCE(attacker.dirty_cash, 0) + CASE WHEN succeeded THEN stolen ELSE 0 END,
    'new_heat', attacker.heat, 'stamina', attacker.stamina
  );
END;
$function$;

-- ---------- attempt_murder: guard takes the bullet ----------
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

  -- bodyguard takes the bullet (070): bullets are spent, shorter cooldown
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
