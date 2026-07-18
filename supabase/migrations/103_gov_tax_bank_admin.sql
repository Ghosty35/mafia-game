-- 103_gov_tax_bank_admin.sql
-- =====================================================================
-- Central, Admin-managed Government Tax Bank.
--
-- Previously gov_tax_bank was a per-player column that passively
-- accumulated from taxes (bank/personal-bank deposits, property buys,
-- auctions, drug trades, etc.). There was no way for the Admin to see
-- or manage the collected tax. This migration adds a single central
-- treasury row that the Admin can deposit into and withdraw from.
-- =====================================================================

-- Single-row treasury. id is always 1.
CREATE TABLE IF NOT EXISTS public.gov_tax_bank (
  id      int PRIMARY KEY DEFAULT 1,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed: pull the existing tax that players have collectively paid so the
-- Admin starts with the real accumulated amount (idempotent).
INSERT INTO public.gov_tax_bank (id, balance, updated_at)
SELECT 1, COALESCE(SUM(COALESCE(gov_tax_bank, 0)), 0), now()
ON CONFLICT (id) DO UPDATE
  SET balance = EXCLUDED.balance,
      updated_at = now()
WHERE public.gov_tax_bank.balance = 0;

-- Read the current treasury balance (admin only).
CREATE OR REPLACE FUNCTION public.admin_get_gov_tax()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_balance bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT balance INTO v_balance FROM public.gov_tax_bank WHERE id = 1;
  RETURN jsonb_build_object('balance', COALESCE(v_balance, 0));
END;
$$;

-- Admin deposits funds into the Gov Tax Bank.
CREATE OR REPLACE FUNCTION public.admin_deposit_gov_tax(p_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_balance bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  INSERT INTO public.gov_tax_bank (id, balance, updated_at) VALUES (1, 0, now())
    ON CONFLICT (id) DO NOTHING;

  UPDATE public.gov_tax_bank SET balance = balance + p_amount, updated_at = now() WHERE id = 1
    RETURNING balance INTO v_balance;

  RETURN jsonb_build_object('success', true, 'deposited', p_amount, 'balance', v_balance);
END;
$$;

-- Admin withdraws funds from the Gov Tax Bank into their own cash.
CREATE OR REPLACE FUNCTION public.admin_withdraw_gov_tax(p_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance bigint;
  v_admin  public.players;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT balance INTO v_balance FROM public.gov_tax_bank WHERE id = 1 FOR UPDATE;
  IF COALESCE(v_balance, 0) < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_TAX'; END IF;

  UPDATE public.gov_tax_bank SET balance = balance - p_amount, updated_at = now() WHERE id = 1;

  SELECT * INTO v_admin FROM public.players WHERE id = auth.uid() FOR UPDATE;
  UPDATE public.players SET cash = cash + p_amount WHERE id = v_admin.id;

  RETURN jsonb_build_object('success', true, 'withdrawn', p_amount, 'balance', v_balance - p_amount, 'new_cash', v_admin.cash + p_amount);
END;
$$;

REVOKE ALL  ON FUNCTION public.admin_get_gov_tax()                FROM public, anon;
REVOKE ALL  ON FUNCTION public.admin_deposit_gov_tax(bigint)      FROM public, anon;
REVOKE ALL  ON FUNCTION public.admin_withdraw_gov_tax(bigint)     FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_gov_tax()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deposit_gov_tax(bigint)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_gov_tax(bigint)   TO authenticated;
