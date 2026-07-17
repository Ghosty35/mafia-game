-- 065_get_my_cooldowns.sql
-- =====================================================================
-- Aggregate every active/known cooldown for the current player into one
-- payload so the Wachttijden (cooldowns) view can render live countdowns.
-- Reads the per-player timestamp fields plus the crime_cooldowns /
-- heist_cooldowns tables (RLS-locked, hence a DEFINER RPC).
-- Each entry: { key, available_at }  (available_at null = ready / N/A).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_my_cooldowns()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  result jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  IF p.id IS NULL THEN RETURN result; END IF;

  -- Single-value cooldowns held on the player row.
  result := result
    || jsonb_build_object('key', 'murder',        'available_at', p.murder_cooldown)
    || jsonb_build_object('key', 'jail',          'available_at', p.jailed_until)
    || jsonb_build_object('key', 'death',         'available_at', p.death_until)
    || jsonb_build_object('key', 'lottery',       'available_at',
         CASE WHEN p.lottery_last_entry IS NOT NULL THEN p.lottery_last_entry + interval '7 days' END)
    || jsonb_build_object('key', 'family_hourly', 'available_at',
         CASE WHEN p.last_family_claim_at IS NOT NULL THEN p.last_family_claim_at + interval '1 hour' END);

  -- Per-crime cooldowns.
  result := result || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('key', 'crime:' || crime_key, 'available_at', available_at))
    FROM public.crime_cooldowns WHERE player_id = p.id
  ), '[]'::jsonb);

  -- Per-heist cooldowns.
  result := result || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('key', 'heist:' || heist_key, 'available_at', available_at))
    FROM public.heist_cooldowns WHERE player_id = p.id
  ), '[]'::jsonb);

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_cooldowns() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_cooldowns() TO authenticated;
