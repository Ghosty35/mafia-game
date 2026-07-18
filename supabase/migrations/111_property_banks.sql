-- 111_property_banks.sql
-- =====================================================================
-- Per-property banks.
-- ---------------------------------------------------------------------
-- EVERY property instance (Red Light District, casino, general bank,
-- airport, etc.) owns its OWN bank, never shared with another instance
-- of the same type. The bank is keyed by the owned-property id (which
-- equals the catalog id, e.g. 'rld_ny', 'casino_la', 'gb_chi').
--
-- The owner of the bank = the player who currently owns that property
-- instance in their owned_properties (set after an auction/marketplace
-- purchase). Window (Red Light) bitches credit the specific district's
-- bank (handled in 110's claim_bitch_earnings). Other property income
-- can credit the same banks later.
--
-- The owner can deposit cash into / withdraw cash from their property
-- bank. Non-owners see the balance but cannot touch it.
-- =====================================================================

-- ---------- A) table ----------
CREATE TABLE IF NOT EXISTS public.property_banks (
  prop_id  text PRIMARY KEY,
  owner_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  balance  bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.property_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_banks_select ON public.property_banks;
CREATE POLICY property_banks_select ON public.property_banks
  FOR SELECT USING (true);

-- ---------- B) owner sync + credit helpers ----------
-- Set the bank owner to whoever owns the property instance (by id).
CREATE OR REPLACE FUNCTION public._prop_bank_sync(p_prop_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT player_id INTO v_owner
  FROM public.players, jsonb_array_elements(owned_properties) AS prop
  WHERE prop->>'id' = p_prop_id OR prop->>'catalog_id' = p_prop_id;
  INSERT INTO public.property_banks (prop_id, owner_id, balance)
  VALUES (p_prop_id, v_owner, 0)
  ON CONFLICT (prop_id) DO UPDATE SET owner_id = v_owner;
END;
$$;

-- Credit a property bank (called from claim_bitch_earnings for window bitches,
-- and from future property-income sweepers).
CREATE OR REPLACE FUNCTION public._prop_bank_credit(p_prop_id text, p_amount bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public._prop_bank_sync(p_prop_id);
  INSERT INTO public.property_banks (prop_id, balance)
  VALUES (p_prop_id, p_amount)
  ON CONFLICT (prop_id) DO UPDATE SET balance = public.property_banks.balance + p_amount;
END;
$$;

-- ---------- C) read: a property bank ----------
CREATE OR REPLACE FUNCTION public.get_property_bank(p_prop_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_balance bigint;
  is_owner boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM public._prop_bank_sync(p_prop_id);
  SELECT owner_id, balance INTO v_owner, v_balance FROM public.property_banks WHERE prop_id = p_prop_id;
  SELECT (v_owner = auth.uid()) INTO is_owner;
  RETURN jsonb_build_object(
    'prop_id', p_prop_id,
    'owner_id', v_owner,
    'is_owner', COALESCE(is_owner, false),
    'balance', COALESCE(v_balance, 0)
  );
END;
$$;

-- ---------- D) owner deposit / withdraw ----------
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
  UPDATE public.players SET cash = cash + p_amount WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true, 'prop_id', p_prop_id, 'balance', v_balance - p_amount, 'withdrawn', p_amount);
END;
$$;

-- ---------- E) Red Light District convenience wrappers (city -> prop id) ----------
CREATE OR REPLACE FUNCTION public.get_rld_bank(p_city text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.get_property_bank('rld_' || lower(replace(p_city, ' ', '_')));
END;
$$;

CREATE OR REPLACE FUNCTION public.rld_deposit(p_city text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.deposit_property_bank('rld_' || lower(replace(p_city, ' ', '_')), p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.rld_withdraw(p_city text, p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.withdraw_property_bank('rld_' || lower(replace(p_city, ' ', '_')), p_amount);
END;
$$;

-- ---------- F) grants ----------
REVOKE ALL ON FUNCTION public._prop_bank_sync(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._prop_bank_sync(text) TO authenticated;
REVOKE ALL ON FUNCTION public._prop_bank_credit(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._prop_bank_credit(text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.get_property_bank(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_property_bank(text) TO authenticated;
REVOKE ALL ON FUNCTION public.deposit_property_bank(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.deposit_property_bank(text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.withdraw_property_bank(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_property_bank(text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.get_rld_bank(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_rld_bank(text) TO authenticated;
REVOKE ALL ON FUNCTION public.rld_deposit(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rld_deposit(text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.rld_withdraw(text, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rld_withdraw(text, bigint) TO authenticated;
