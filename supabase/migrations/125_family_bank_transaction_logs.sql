-- 125_family_bank_transaction_logs.sql
-- Add transaction logging to family bank operations.
-- Logs the last 10 family bank transactions (donations, power purchases).

-- ============================================================
-- 1) Add bank_transactions column to families table
-- ============================================================
ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS bank_transactions jsonb DEFAULT '[]'::jsonb;

-- ============================================================
-- 2) Helper: append a transaction entry and keep only the last 10
-- ============================================================
CREATE OR REPLACE FUNCTION public._append_family_txn(
  p_family_id uuid,
  p_icon text,
  p_desc text,
  p_amount bigint,
  p_player_name text DEFAULT 'Unknown'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cur jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(bank_transactions, '[]'::jsonb) INTO cur FROM public.families WHERE id = p_family_id;
  cur := jsonb_build_array(
    jsonb_build_object(
      'icon', p_icon,
      'desc', p_desc,
      'amount', p_amount,
      'player', p_player_name,
      'at', to_char(now(), 'YYYY-MM-DD HH24:MI')
    )
  ) || cur;
  IF jsonb_array_length(cur) > 10 THEN
    cur := cur -> 0 || cur -> 1 || cur -> 2 || cur -> 3 || cur -> 4
         || cur -> 5 || cur -> 6 || cur -> 7 || cur -> 8 || cur -> 9;
  END IF;
  UPDATE public.families SET bank_transactions = cur WHERE id = p_family_id;
END;
$$;

-- ============================================================
-- 3) Update donate_to_family to log transactions
-- ============================================================
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

  PERFORM public._append_family_txn(my_family_id, '💸', 'Donation', amount, COALESCE(p.username, 'Unknown'));

  RETURN jsonb_build_object(
    'success', true,
    'donated', amount,
    'my_total_donated', COALESCE(my_total, amount),
    'new_bank', (SELECT bank FROM public.families WHERE id = my_family_id),
    'respect_gained', respect_gain
  );
END;
$$;

-- ============================================================
-- 4) Update buy_family_power to log transactions
-- ============================================================
CREATE OR REPLACE FUNCTION public.buy_family_power(spend_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  fam public.families;
  power_gain bigint;
  my_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id, username INTO my_family_id, my_username FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF NOT (my_role IN ('boss', 'underboss', 'accountant')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_BUY_POWER';
  END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id FOR UPDATE;

  IF spend_amount < 25000 OR spend_amount > fam.bank THEN
    RAISE EXCEPTION 'INVALID_SPEND_AMOUNT';
  END IF;

  power_gain := GREATEST(5, floor(spend_amount / 2000));

  UPDATE public.families
  SET
    bank = bank - spend_amount,
    power = power + power_gain
  WHERE id = my_family_id;

  PERFORM public._append_family_txn(my_family_id, '⚔️', 'Power purchase', spend_amount, COALESCE(my_username, 'Unknown'));

  RETURN jsonb_build_object(
    'success', true,
    'spent', spend_amount,
    'power_gained', power_gain,
    'new_power', (SELECT power FROM public.families WHERE id = my_family_id)
  );
END;
$$;

-- ============================================================
-- 5) RPC to fetch family bank transactions (last 10)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_family_bank_transactions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT COALESCE(bank_transactions, '[]'::jsonb) INTO result FROM public.families WHERE id = my_family_id;

  RETURN result;
END;
$$;
