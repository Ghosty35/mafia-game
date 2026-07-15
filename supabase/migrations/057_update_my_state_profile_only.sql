-- 057_update_my_state_profile_only.sql
-- =====================================================================
-- SECURITY — update_my_state teruggebracht tot profiel-only
-- ---------------------------------------------------------------------
-- Enige legitieme schrijver van update_my_state is de safehouse-profiel-
-- save: { avatar_url, bio } (geverifieerd, app-breed). De overige velden
-- waren direct forgeable via een directe RPC-call:
--   * heist_gear      -> commit_heist leest dit voor slaagkans (buyGear
--                        persisteert niet legitiem) = betere heist-odds forgen
--   * transaction_log -> bank leest dit (server schrijft het via bank-RPC's);
--     bill_history        client kon nep-historie injecteren
--   * autopay_bills   -> wordt nergens via update_my_state gezet
--
-- We strippen alles behalve avatar_url/bio. heist_gear hoort later via een
-- dedicated buy_heist_gear() RPC (D-spoor heist-hardening).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.update_my_state(patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.players SET
    avatar_url = CASE WHEN patch ? 'avatar_url' THEN patch->>'avatar_url' ELSE avatar_url END,
    bio        = CASE WHEN patch ? 'bio' THEN patch->>'bio' ELSE bio END
    -- alle overige velden zijn server-owned via dedicated RPC's
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;
