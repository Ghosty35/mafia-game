-- 124_fix_family_bank_pending_donation_regression.sql
-- =====================================================================
-- Fix family bank regression: migrate 087/093/101/102 accidentally
-- reverted donate_to_family back to pending_bank after migration 074
-- had already removed the pending-donation flow. Consolidate any
-- stranded pending_bank into bank, drop the dead column, and restore
-- the correct direct-to-bank donate logic with member tracking.
-- =====================================================================

-- ---------- A) consolidate stranded pending_bank into bank ----------

UPDATE public.families
SET bank = COALESCE(bank, 0) + COALESCE(pending_bank, 0),
    pending_bank = 0
WHERE COALESCE(pending_bank, 0) > 0;

-- ---------- B) drop the dead pending_bank column ----------

ALTER TABLE public.families DROP COLUMN IF EXISTS pending_bank;

-- ---------- C) restore correct donate_to_family ----------
-- Direct to bank + respect + member donated total (migration 074 logic
-- combined with migration 102's FOR UPDATE + atomic race-safety).

CREATE OR REPLACE FUNCTION public.donate_to_family(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  p public.players;
  my_total bigint;
  respect_gain bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT family_id INTO my_family_id
  FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN
    RAISE EXCEPTION 'DEAD';
  END IF;
  IF p.cash < amount THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players SET cash = cash - amount WHERE id = p.id AND cash >= amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  respect_gain := GREATEST(1, floor(amount / 10));

  UPDATE public.families
  SET bank = bank + amount,
      respect = respect + respect_gain
  WHERE id = my_family_id;

  UPDATE public.family_members
  SET donated = donated + amount
  WHERE family_id = my_family_id AND player_id = auth.uid()
  RETURNING donated INTO my_total;

  RETURN jsonb_build_object(
    'success', true,
    'donated', amount,
    'my_total_donated', COALESCE(my_total, amount),
    'new_bank', (SELECT bank FROM public.families WHERE id = my_family_id),
    'respect_gained', respect_gain
  );
END;
$$;

-- ---------- D) fix admin_banks_overview ----------

CREATE OR REPLACE FUNCTION public.admin_banks_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_personal  bigint := 0;
  v_fam_bank  bigint := 0;
  v_gov       bigint := 0;
  v_lottery   bigint := 0;
  v_blackjack bigint := 0;
  v_roulette  bigint := 0;
  v_general   bigint := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT COALESCE(SUM(COALESCE(personal_bank, 0)), 0)
    INTO v_personal FROM public.players;

  SELECT COALESCE(SUM(COALESCE(bank, 0)), 0)
    INTO v_fam_bank FROM public.families;

  SELECT COALESCE(balance, 0) INTO v_gov FROM public.gov_tax_bank WHERE id = 1;

  SELECT COALESCE(lottery, 0), COALESCE(blackjack, 0), COALESCE(roulette, 0), COALESCE(general, 0)
    INTO v_lottery, v_blackjack, v_roulette, v_general
    FROM public.casino_pools WHERE id = 1;

  RETURN jsonb_build_object(
    'personal_bank_total', v_personal,
    'family_bank_total',    v_fam_bank,
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
