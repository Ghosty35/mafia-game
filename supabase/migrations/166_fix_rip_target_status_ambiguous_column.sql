-- 166_fix_rip_target_status_ambiguous_column.sql
-- Fix PostgreSQL error 42702 in get_rip_target_status:
-- "column reference 'attacker_id' is ambiguous"
-- The PL/pgSQL variable attacker_id collided with the rip_cooldowns.attacker_id column.

CREATE OR REPLACE FUNCTION public.get_rip_target_status(target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  target public.players;
  v_attacker_id uuid;
  cd timestamptz;
  can_rip boolean := true;
  reason text := '';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT id INTO v_attacker_id FROM public.players WHERE id = auth.uid();

  SELECT * INTO target FROM public.players WHERE username = target_username;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'can_rip', false, 'reason', 'TARGET_NOT_FOUND');
  END IF;

  IF target.id = v_attacker_id THEN
    RETURN jsonb_build_object('found', true, 'can_rip', false, 'reason', 'CANNOT_TARGET_SELF');
  END IF;

  IF target.death_until IS NOT NULL AND target.death_until > now() THEN
    can_rip := false;
    reason := 'TARGET_DEAD';
  ELSIF target.kill_protected_until IS NOT NULL AND target.kill_protected_until > now() THEN
    can_rip := false;
    reason := 'TARGET_PROTECTED';
  ELSIF COALESCE(target.cash, 0) < 100 THEN
    can_rip := false;
    reason := 'TARGET_NO_CASH';
  ELSE
    SELECT available_at INTO cd FROM public.rip_cooldowns
     WHERE attacker_id = v_attacker_id AND target_id = target.id;
    IF cd IS NOT NULL AND cd > now() THEN
      can_rip := false;
      reason := 'ON_COOLDOWN';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'can_rip', can_rip,
    'reason', reason,
    'target_username', target.username,
    'target_cash', COALESCE(target.cash, 0),
    'target_dead', target.death_until IS NOT NULL AND target.death_until > now(),
    'target_protected', target.kill_protected_until IS NOT NULL AND target.kill_protected_until > now(),
    'cooldown_until', cd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_rip_target_status(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_rip_target_status(text) TO authenticated;
