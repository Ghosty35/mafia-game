-- 122_transaction_logs_for_all_banks.sql
-- Add transaction logging to property bank, gov tax, and piggy bank operations.

-- ============================================================
-- 1) Property bank deposit/withdraw logs
-- ============================================================
CREATE OR REPLACE FUNCTION public.deposit_property_bank(p_prop_id text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  v_owner uuid;
  v_balance bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  PERFORM public._prop_bank_sync(p_prop_id);
  SELECT owner_id INTO v_owner FROM public.property_banks WHERE prop_id = p_prop_id;
  IF v_owner IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_PROPERTY_OWNER'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.cash < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - p_amount WHERE id = p.id;
  UPDATE public.property_banks SET balance = balance + p_amount WHERE prop_id = p_prop_id
    RETURNING balance INTO v_balance;

  PERFORM public._append_txn(p.id, '⬆️', 'Property bank deposit', -p_amount, 0);
  RETURN jsonb_build_object('success', true, 'prop_id', p_prop_id, 'balance', v_balance, 'cash', p.cash);
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_property_bank(p_prop_id text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  v_owner uuid;
  v_balance bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  PERFORM public._prop_bank_sync(p_prop_id);
  SELECT owner_id INTO v_owner FROM public.property_banks WHERE prop_id = p_prop_id;
  IF v_owner IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_PROPERTY_OWNER'; END IF;

  SELECT balance INTO v_balance FROM public.property_banks WHERE prop_id = p_prop_id FOR UPDATE;
  IF COALESCE(v_balance, 0) < p_amount THEN RAISE EXCEPTION 'PROPERTY_BANK_INSUFFICIENT'; END IF;

  UPDATE public.property_banks SET balance = balance - p_amount WHERE prop_id = p_prop_id;
  UPDATE public.players SET cash = cash + p_amount WHERE id = auth.uid()
    RETURNING cash INTO p.cash;

  PERFORM public._append_txn(auth.uid(), '⬇️', 'Property bank withdraw', p_amount, 0);
  RETURN jsonb_build_object('success', true, 'prop_id', p_prop_id, 'balance', v_balance - p_amount, 'withdrawn', p_amount);
END;
$$;

-- ============================================================
-- 2) Gov tax deposit log
-- ============================================================
CREATE OR REPLACE FUNCTION public.gov_tax_deposit(amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - amount,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + amount
  WHERE id = p.id;

  PERFORM public._append_txn(p.id, '🏛️', 'Gov Tax deposit', -amount, 0);
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 3) Piggy bank logs
-- ============================================================
CREATE OR REPLACE FUNCTION public.piggy_deposit(prop_id text, amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      el := jsonb_set(el, '{piggy_bank}',
                      to_jsonb(COALESCE((el->>'piggy_bank')::bigint, 0) + amount));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash - amount, owned_properties = new_props
  WHERE id = p.id;

  PERFORM public._append_txn(p.id, '🐷', 'Piggy Bank deposit', -amount, 0);
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.piggy_withdraw(prop_id text, amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
  fee bigint;
  net bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  fee := floor(amount * 0.008)::bigint;
  net := amount - fee;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      IF COALESCE((el->>'piggy_bank')::bigint, 0) < amount THEN
        RAISE EXCEPTION 'NOT_ENOUGH_IN_PIGGYBANK';
      END IF;
      el := jsonb_set(el, '{piggy_bank}',
                      to_jsonb(COALESCE((el->>'piggy_bank')::bigint, 0) - amount));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash + net,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + fee,
      owned_properties = new_props
  WHERE id = p.id;

  PERFORM public._append_txn(p.id, '🐷', 'Piggy Bank withdraw', net, fee);
  RETURN jsonb_build_object('success', true, 'net', net, 'fee', fee);
END;
$$;
