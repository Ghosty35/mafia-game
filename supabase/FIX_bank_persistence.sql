-- ============================================================
-- FIX: Make bank deposits/withdraws fully atomic and reliable
-- Run this entire block in Supabase SQL Editor
-- This updates the RPCs so cash <-> personal_bank + gov tax
-- are updated together in one call. No more separate updates
-- that could cause reverts on refresh/navigation.
-- ============================================================

-- Make sure columns exist (safe if already there)
ALTER TABLE public.players 
  ADD COLUMN IF NOT EXISTS personal_bank bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gov_tax_bank bigint NOT NULL DEFAULT 0;

-- Updated Deposit RPC (now handles 0.5% gov tax inside)
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

  IF p.cash < amount THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  p.cash := p.cash - amount;
  p.personal_bank := p.personal_bank + amount;
  p.gov_tax_bank := COALESCE(p.gov_tax_bank, 0) + tax;

  UPDATE public.players 
  SET cash = p.cash, 
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  WHERE id = p.id;

  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

-- Updated Withdraw RPC (now handles 0.5% gov tax inside)
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

  IF p.personal_bank < amount THEN
    RAISE EXCEPTION 'NOT_ENOUGH_IN_BANK';
  END IF;

  p.personal_bank := p.personal_bank - amount;
  p.cash := p.cash + amount;
  p.gov_tax_bank := COALESCE(p.gov_tax_bank, 0) + tax;

  UPDATE public.players 
  SET cash = p.cash, 
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  WHERE id = p.id;

  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

-- Optional: quick test (uncomment and run with your player id if needed)
-- SELECT * FROM public.deposit_personal_bank(1000);
-- SELECT * FROM public.withdraw_personal_bank(500);

COMMENT ON FUNCTION public.deposit_personal_bank(bigint) IS 'Atomic deposit + 0.5% gov tax. Use from Bank page.';
COMMENT ON FUNCTION public.withdraw_personal_bank(bigint) IS 'Atomic withdraw + 0.5% gov tax. Use from Bank page.';