-- Migration for proper murder RPC with rank and kills kill thresholds

-- Ensure columns
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS murder_cooldown timestamptz,
ADD COLUMN IF NOT EXISTS drug_storage jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS cars jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS current_property_id uuid;

-- RPC for murder attempt with exact thresholds
CREATE OR REPLACE FUNCTION public.attempt_murder(
  target_username text,
  weapon text,
  bullets_used int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attacker public.players;
  target public.players;
  attacker_rank text;
  attacker_level int;
  attacker_skill numeric;
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

  -- Check cooldown
  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;

  -- Check unlock: Hitman rank (level 16+) and 50% KillSkill
  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);
  
  IF attacker_level < 16 OR attacker_skill < 10 THEN  -- 50% = 10 if scaled *5 in UI
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;

  -- Base success from skill (assume skill 0-20 for 0-100%)
  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));

  -- Clean hit bonus if 75%+
  IF attacker_skill >= 15 THEN
    success_chance := success_chance + 15;
  END IF;

  -- Weapon bonus (from previous WEAPONS)
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;

  -- Bullets bonus (capped)
  success_chance := success_chance + LEAST(20, bullets_used / 25);

  succeeded := random() < (success_chance / 100);

  -- Consume bullets
  attacker.bullets := GREATEST(0, COALESCE(attacker.bullets, 0) - bullets_used);

  IF succeeded THEN
    stolen := FLOOR(target.cash * 0.2);
    attacker.cash := attacker.cash + stolen;
    attacker.murder_skill := COALESCE(attacker.murder_skill, 0) + skill_gain;
    heat_gain := 15;
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain + 10);
  END IF;

  attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '1 hour';
  attacker.murder_cooldown := cooldown_end;

  UPDATE public.players SET 
    cash = attacker.cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
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
    'player', to_jsonb(attacker)
  );
END;
$$;

-- Function to get player drug storage (for live tracker)
CREATE OR REPLACE FUNCTION public.get_drug_storage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(drug_storage, '{}'::jsonb) FROM public.players WHERE id = auth.uid();
$$;