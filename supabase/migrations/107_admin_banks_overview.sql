-- 107_admin_banks_overview.sql
-- =====================================================================
-- A single admin RPC that aggregates EVERY bank balance in one call, so
-- the Admin Tools page can show "all the banks" in one overview submenu:
--   * total personal bank across all players
--   * total family bank (bank + pending_bank) across all families
--   * gov tax bank
--   * lottery pool
--   * casino pools (blackjack / roulette / general)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_banks_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_personal   bigint := 0;
  v_fam_bank   bigint := 0;
  v_fam_pend   bigint := 0;
  v_gov        bigint := 0;
  v_lottery    bigint := 0;
  v_blackjack  bigint := 0;
  v_roulette   bigint := 0;
  v_general    bigint := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT COALESCE(SUM(COALESCE(personal_bank, 0)), 0)
    INTO v_personal FROM public.players;

  SELECT COALESCE(SUM(COALESCE(bank, 0)), 0), COALESCE(SUM(COALESCE(pending_bank, 0)), 0)
    INTO v_fam_bank, v_fam_pend FROM public.families;

  SELECT COALESCE(balance, 0) INTO v_gov FROM public.gov_tax_bank WHERE id = 1;

  SELECT COALESCE(lottery, 0), COALESCE(blackjack, 0), COALESCE(roulette, 0), COALESCE(general, 0)
    INTO v_lottery, v_blackjack, v_roulette, v_general
    FROM public.casino_pools WHERE id = 1;

  RETURN jsonb_build_object(
    'personal_bank_total', v_personal,
    'family_bank_total',    v_fam_bank,
    'family_pending_total', v_fam_pend,
    'gov_tax',              v_gov,
    'lottery_pool',         v_lottery,
    'casino_blackjack',     v_blackjack,
    'casino_roulette',      v_roulette,
    'casino_general',       v_general
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_banks_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_banks_overview() TO authenticated;
