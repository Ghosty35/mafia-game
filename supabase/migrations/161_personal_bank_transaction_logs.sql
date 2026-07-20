-- 161_personal_bank_transaction_logs.sql
-- Fix: restore transaction logging to personal bank deposit/withdraw RPCs.
-- Migration 105 added _append_txn calls, but later migrations (102, FIX_bank_persistence)
-- overwrote deposit_personal_bank and withdraw_personal_bank without the logging.

CREATE OR REPLACE FUNCTION public.deposit_personal_bank(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  tax bigint := floor(amount * 0.005);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  p.cash := p.cash - amount;
  p.personal_bank := p.personal_bank + amount;
  p.gov_tax_bank := COALESCE(p.gov_tax_bank, 0) + tax;

  UPDATE public.players
  SET cash = p.cash,
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  WHERE id = p.id;

  PERFORM public._append_txn(p.id, '⬆️', 'Deposit to bank', amount, tax);
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_personal_bank(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  tax bigint := floor(amount * 0.005);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.personal_bank < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_IN_BANK'; END IF;

  p.personal_bank := p.personal_bank - amount;
  p.cash := p.cash + amount;
  p.gov_tax_bank := COALESCE(p.gov_tax_bank, 0) + tax;

  UPDATE public.players
  SET cash = p.cash,
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  WHERE id = p.id;

  PERFORM public._append_txn(p.id, '⬇️', 'Withdraw from bank', -amount, tax);
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;
