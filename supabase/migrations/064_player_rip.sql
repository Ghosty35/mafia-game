-- 064_player_rip.sql
-- =====================================================================
-- PvP "RIP" (rob) — steal cash-on-hand from another player.
-- ---------------------------------------------------------------------
-- Lighter, always-available counterpart to attempt_murder. Server-
-- authoritative: the client only names a target; the server picks the
-- steal amount and success outcome.
--   * Steals 10%-20% of the target's cash-on-hand (bank is SAFE).
--   * Success scales with level difference (attacker - target).
--   * Fail => attacker gains heat (no theft).
--   * 4-second cooldown per (attacker, target) pair.
--   * Emits a 'rip' activity-feed event on success.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.rip_cooldowns (
  attacker_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  available_at timestamptz NOT NULL,
  PRIMARY KEY (attacker_id, target_id)
);
-- RLS on, no policies: only reachable via the SECURITY DEFINER RPC below.
ALTER TABLE public.rip_cooldowns ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rip_player(target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  attacker public.players;
  target   public.players;
  cd timestamptz;
  lvl_diff int;
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

  -- 4s per-target cooldown
  SELECT available_at INTO cd FROM public.rip_cooldowns
   WHERE attacker_id = attacker.id AND target_id = target.id;
  IF cd IS NOT NULL AND cd > now() THEN RAISE EXCEPTION 'ON_COOLDOWN'; END IF;

  -- success scales with level difference, clamped 20%-90%
  lvl_diff := COALESCE(attacker.level, 1) - COALESCE(target.level, 1);
  success_chance := LEAST(90, GREATEST(20, 60 + lvl_diff * 3));
  succeeded := random() < (success_chance / 100.0);

  IF succeeded THEN
    pct := 0.10 + random() * 0.10;                 -- 10%-20%
    stolen := GREATEST(1, FLOOR(target.cash * pct));
    attacker.cash := attacker.cash + stolen;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 5);
    UPDATE public.players SET cash = GREATEST(0, cash - stolen) WHERE id = target.id;
    UPDATE public.players SET cash = attacker.cash, heat = attacker.heat, heat_updated_at = now()
     WHERE id = attacker.id;
    PERFORM public.log_event('rip', 'ripped ' || target.username || ' for $' || stolen || '!');
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 15);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
  END IF;

  INSERT INTO public.rip_cooldowns (attacker_id, target_id, available_at)
  VALUES (attacker.id, target.id, now() + interval '4 seconds')
  ON CONFLICT (attacker_id, target_id) DO UPDATE SET available_at = excluded.available_at;

  RETURN jsonb_build_object(
    'success', succeeded,
    'stolen', stolen,
    'target', target.username,
    'success_chance', ROUND(success_chance),
    'new_cash', attacker.cash,
    'new_heat', attacker.heat
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rip_player(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rip_player(text) TO authenticated;
