-- ============================================================
-- 143_harden_apply_action.sql (renumbered from 090; must run AFTER 118/120 which also redefine apply_action)
-- ============================================================
-- apply_action() was reintroduced with full patch fields in 120,
-- undoing the 054 security hardening. This migration restores the
-- locked-down version: no income (cash_delta must be <= 0), no
-- patch fields, only cash deduction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Client may NEVER assign income; only burn own cash.
  IF cash_delta > 0 THEN
    RAISE EXCEPTION 'CASH_DELTA_MUST_BE_NEGATIVE';
  END IF;
  IF cash_delta < -10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF public.is_banned(p.id) THEN
    RAISE EXCEPTION 'BANNED';
  END IF;
  IF public.is_timed_out(p.id) THEN
    RAISE EXCEPTION 'TIMED_OUT';
  END IF;

  IF p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  -- No patch fields: every mutation must go through a dedicated RPC.
  UPDATE public.players
  SET cash = cash + cash_delta
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;
