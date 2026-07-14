-- ============================================================
-- 035: Admin tools + client persistence fixes
--
-- WHY: the players table has RLS with NO update policy (by design,
-- see 001_players.sql). Every direct `.from('players').update(...)`
-- from the browser silently updates 0 rows. This migration adds
-- SECURITY DEFINER RPCs for every flow that previously wrote
-- directly from the client:
--   * Admin panel (give cash, edit fields, donator, clear jail/death)
--   * Gov tax deposits (bank page)
--   * Weekly lottery (server-side draw)
--   * Piggybank deposit/withdraw, shed upgrade, bodyguards (safehouse)
--   * Property purchase, bill payment, autopay (real estate)
--   * Donator purchase + VIP family buffs (shop)
--   * Family tag change (families)
--   * Force respawn (dead page)
--   * update_my_state: whitelisted jsonb/profile columns only
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- ---------- 0) Columns used by the app that may not exist yet ----------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS gov_tax_bank bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS weed_progress int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_harvest_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_harvest_kg numeric NOT NULL DEFAULT 0;

-- ---------- 1) Admin helper ----------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT username = 'YGhosty' FROM public.players WHERE id = auth.uid()),
    false
  );
$$;

-- ---------- 2) Admin: give cash ----------
CREATE OR REPLACE FUNCTION public.admin_give_cash(target_username text, amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t public.players;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO t FROM public.players
  WHERE username ILIKE target_username
  LIMIT 1
  FOR UPDATE;

  IF t.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = GREATEST(0, cash + amount)
  WHERE id = t.id;

  RETURN jsonb_build_object('success', true, 'username', t.username,
                            'new_cash', GREATEST(0, t.cash + amount));
END;
$$;

-- ---------- 3) Admin: set donator ----------
CREATE OR REPLACE FUNCTION public.admin_set_donator(target_username text, val boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT id INTO t_id FROM public.players WHERE username ILIKE target_username LIMIT 1;
  IF t_id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE public.players
  SET is_donator = val,
      donator_since = CASE WHEN val THEN now() ELSE NULL END
  WHERE id = t_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 4) Admin: clear jail / death ----------
CREATE OR REPLACE FUNCTION public.admin_clear_status(target_id uuid, status_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF status_type = 'jail' THEN
    UPDATE public.players SET jailed_until = NULL WHERE id = target_id;
  ELSIF status_type = 'death' THEN
    UPDATE public.players SET death_until = NULL, health = GREATEST(health, 1) WHERE id = target_id;
  ELSE
    RAISE EXCEPTION 'INVALID_STATUS_TYPE';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 5) Admin: edit a whitelisted player field ----------
CREATE OR REPLACE FUNCTION public.admin_update_player_field(target_id uuid, field_name text, field_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF field_name = 'cash' THEN
    UPDATE public.players SET cash = field_value::bigint WHERE id = target_id;
  ELSIF field_name = 'personal_bank' THEN
    UPDATE public.players SET personal_bank = field_value::bigint WHERE id = target_id;
  ELSIF field_name = 'level' THEN
    UPDATE public.players SET level = field_value::int WHERE id = target_id;
  ELSIF field_name = 'power' THEN
    UPDATE public.players SET power = field_value::bigint WHERE id = target_id;
  ELSIF field_name = 'murder_skill' THEN
    UPDATE public.players SET murder_skill = field_value::numeric WHERE id = target_id;
  ELSIF field_name = 'heat' THEN
    UPDATE public.players SET heat = field_value::int WHERE id = target_id;
  ELSIF field_name = 'health' THEN
    UPDATE public.players SET health = field_value::int WHERE id = target_id;
  ELSIF field_name = 'bullets' THEN
    UPDATE public.players SET bullets = field_value::bigint WHERE id = target_id;
  ELSIF field_name = 'diamonds' THEN
    UPDATE public.players SET diamonds = field_value::bigint WHERE id = target_id;
  ELSIF field_name = 'is_donator' THEN
    UPDATE public.players SET is_donator = field_value::boolean WHERE id = target_id;
  ELSE
    RAISE EXCEPTION 'FIELD_NOT_ALLOWED: %', field_name;
  END IF;

  RETURN jsonb_build_object('success', true, 'field', field_name);
END;
$$;

-- ---------- 6) Admin: stimulus to top 10 ----------
CREATE OR REPLACE FUNCTION public.admin_stimulus(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.players
  SET cash = cash + amount
  WHERE id IN (SELECT id FROM public.players ORDER BY cash DESC LIMIT 10);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'players_affected', affected);
END;
$$;

-- ---------- 7) Self: update whitelisted non-money state ----------
-- For jsonb/profile fields the client legitimately manages
-- (properties metadata, cars, weed, profile). Money fields are
-- deliberately NOT included.
CREATE OR REPLACE FUNCTION public.update_my_state(patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.players SET
    owned_properties      = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    cars                  = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level          = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    drug_storage          = CASE WHEN patch ? 'drug_storage' THEN patch->'drug_storage' ELSE drug_storage END,
    weed_plants           = CASE WHEN patch ? 'weed_plants' THEN patch->'weed_plants' ELSE weed_plants END,
    weed_progress         = CASE WHEN patch ? 'weed_progress' THEN (patch->>'weed_progress')::int ELSE weed_progress END,
    successful_harvest_kg = CASE WHEN patch ? 'successful_harvest_kg' THEN (patch->>'successful_harvest_kg')::numeric ELSE successful_harvest_kg END,
    failed_harvest_kg     = CASE WHEN patch ? 'failed_harvest_kg' THEN (patch->>'failed_harvest_kg')::numeric ELSE failed_harvest_kg END,
    avatar_url            = CASE WHEN patch ? 'avatar_url' THEN patch->>'avatar_url' ELSE avatar_url END,
    bio                   = CASE WHEN patch ? 'bio' THEN patch->>'bio' ELSE bio END,
    autopay_bills         = CASE WHEN patch ? 'autopay_bills' THEN (patch->>'autopay_bills')::boolean ELSE autopay_bills END,
    transaction_log       = CASE WHEN patch ? 'transaction_log' THEN patch->'transaction_log' ELSE transaction_log END,
    bill_history          = CASE WHEN patch ? 'bill_history' THEN patch->'bill_history' ELSE bill_history END,
    heist_gear            = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 8) Self: gov tax deposit ----------
CREATE OR REPLACE FUNCTION public.gov_tax_deposit(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 9) Self: weekly lottery (server-side draw) ----------
-- Same odds the client used before, now tamper-proof:
-- donators 14%, non-donators 37%. Big pool pays 8% slice.
CREATE OR REPLACE FUNCTION public.enter_weekly_lottery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  win_chance numeric;
  pool bigint;
  prize bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  win_chance := CASE WHEN COALESCE(p.is_donator, false) THEN 0.14 ELSE 0.37 END;

  IF random() >= win_chance THEN
    RETURN jsonb_build_object('won', false);
  END IF;

  prize := 25000 + floor(random() * 80000)::bigint;

  SELECT lottery INTO pool FROM public.casino_pools WHERE id = 1;
  IF COALESCE(pool, 0) > 200000 THEN
    prize := floor(pool * 0.08)::bigint;
    UPDATE public.casino_pools SET lottery = GREATEST(0, lottery - prize) WHERE id = 1;
  END IF;

  UPDATE public.players SET cash = cash + prize WHERE id = p.id;

  RETURN jsonb_build_object('won', true, 'prize', prize);
END;
$$;

-- ---------- 10) Self: piggybank (Mansion hidden safe) ----------
CREATE OR REPLACE FUNCTION public.piggy_deposit(prop_id text, amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.piggy_withdraw(prop_id text, amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  fee := floor(amount * 0.008)::bigint;  -- 0.8% fee to Gov Tax
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

  RETURN jsonb_build_object('success', true, 'net', net, 'fee', fee);
END;
$$;

-- ---------- 11) Self: shed upgrade ----------
CREATE OR REPLACE FUNCTION public.upgrade_shed(prop_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
  lvl int;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      lvl := COALESCE((el->>'shed_level')::int, 1);
      IF lvl >= 3 THEN RAISE EXCEPTION 'MAX_SHED_LEVEL'; END IF;
      cost := 50000 * lvl;
      IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
      el := jsonb_set(el, '{shed_level}', to_jsonb(lvl + 1));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash - cost, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_level', lvl + 1, 'cost', cost);
END;
$$;

-- ---------- 12) Self: hire bodyguard (Villa raid protection) ----------
CREATE OR REPLACE FUNCTION public.hire_bodyguard(prop_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
  guards int;
  cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      guards := COALESCE((el->>'bodyguards')::int, 0);
      IF guards >= 10 THEN RAISE EXCEPTION 'MAX_BODYGUARDS'; END IF;
      cost := 2000;
      IF guards >= 5 THEN
        cost := floor(2000 * (1 - (guards - 5) * 0.002))::bigint;
      END IF;
      IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
      el := jsonb_set(el, '{bodyguards}', to_jsonb(guards + 1));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET cash = cash - cost, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'bodyguards', guards + 1, 'cost', cost);
END;
$$;

-- ---------- 13) Self: purchase property (10% tax to gov) ----------
CREATE OR REPLACE FUNCTION public.purchase_property(prop jsonb, price bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  tax bigint;
  total_cost bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF jsonb_array_length(COALESCE(p.owned_properties, '[]'::jsonb)) >= 4 THEN
    RAISE EXCEPTION 'PROPERTY_LIMIT_REACHED';
  END IF;

  tax := floor(price * 0.10)::bigint;
  total_cost := price + tax;

  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      owned_properties = COALESCE(owned_properties, '[]'::jsonb) || jsonb_build_array(prop)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tax', tax, 'total_cost', total_cost);
END;
$$;

-- ---------- 14) Self: pay property bill ----------
CREATE OR REPLACE FUNCTION public.pay_property_bill(prop_id text, amount bigint, method text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
  debt bigint;
  pay bigint;
  bank_pay bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      debt := COALESCE((el->>'maintenance_due')::bigint, 850);
      pay := LEAST(amount, debt);
      el := jsonb_set(el, '{maintenance_due}', to_jsonb(debt - pay));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  IF method = 'cash' THEN
    IF p.cash < pay THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
    UPDATE public.players
    SET cash = cash - pay,
        gov_tax_bank = COALESCE(gov_tax_bank, 0) + pay,
        owned_properties = new_props
    WHERE id = p.id;
  ELSIF method = 'bank' THEN
    bank_pay := ceil(pay * 1.05)::bigint;  -- 5% extra tax when paying from bank
    IF p.personal_bank < bank_pay THEN RAISE EXCEPTION 'NOT_ENOUGH_IN_BANK'; END IF;
    UPDATE public.players
    SET personal_bank = personal_bank - bank_pay,
        gov_tax_bank = COALESCE(gov_tax_bank, 0) + bank_pay,
        owned_properties = new_props
    WHERE id = p.id;
  ELSE
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;

  RETURN jsonb_build_object('success', true, 'paid', pay);
END;
$$;

-- ---------- 15) Self: property autopay toggle ----------
CREATE OR REPLACE FUNCTION public.set_property_autopay(prop_id text, enable boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  new_props jsonb := '[]'::jsonb;
  el jsonb;
  found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = prop_id THEN
      el := jsonb_set(el, '{autopay}', to_jsonb(enable));
      found := true;
    END IF;
    new_props := new_props || jsonb_build_array(el);
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;

  UPDATE public.players
  SET owned_properties = new_props, autopay_bills = enable
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 16) Self: purchase donator status with diamonds ----------
CREATE OR REPLACE FUNCTION public.purchase_donator(cost_diamonds bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_diamonds < 500 THEN RAISE EXCEPTION 'INVALID_COST'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF COALESCE(p.is_donator, false) THEN RAISE EXCEPTION 'ALREADY_DONATOR'; END IF;
  IF COALESCE(p.diamonds, 0) < cost_diamonds THEN RAISE EXCEPTION 'NOT_ENOUGH_DIAMONDS'; END IF;

  UPDATE public.players
  SET diamonds = diamonds - cost_diamonds,
      is_donator = true,
      donator_since = now()
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 17) Self: VIP family buff with diamonds ----------
-- Deducts diamonds and adds power to the caller's family.
-- power_gain is bounded relative to diamonds spent to prevent abuse.
CREATE OR REPLACE FUNCTION public.buy_family_buff_diamonds(cost_diamonds bigint, power_gain int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_diamonds <= 0 OR power_gain <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF power_gain > cost_diamonds * 6 THEN RAISE EXCEPTION 'POWER_GAIN_TOO_HIGH'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(p.diamonds, 0) < cost_diamonds THEN RAISE EXCEPTION 'NOT_ENOUGH_DIAMONDS'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET diamonds = diamonds - cost_diamonds WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

-- ---------- 18) Self: family tag change (boss only) ----------
CREATE OR REPLACE FUNCTION public.set_family_tag(new_tag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  fam_id uuid;
  my_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  new_tag := upper(trim(new_tag));
  IF length(new_tag) < 2 OR length(new_tag) > 5 THEN
    RAISE EXCEPTION 'TAG_MUST_BE_2_TO_5_CHARS';
  END IF;

  SELECT family_id, role INTO fam_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();

  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF my_role <> 'boss' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.families SET tag = new_tag WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'tag', new_tag);
END;
$$;

-- ---------- 19) Self: force respawn (testing button on /dead) ----------
CREATE OR REPLACE FUNCTION public.force_respawn()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.players
  SET death_until = NULL,
      health = GREATEST(health, 1),
      kill_protected_until = NULL
  WHERE id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------- 19a) Self: generic game action (bounded cash delta + state patch) ----------
-- Used by garage, race, marketplace, jail training, street dealer and weed
-- grow until each system gets its own dedicated server-side RPC. The cash
-- delta is bounded per call; money columns other than cash are not touchable.
CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cash_delta < -10000000 OR cash_delta > 10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF cash_delta < 0 AND p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players SET
    cash                  = cash + cash_delta,
    owned_properties      = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    cars                  = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level          = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    drug_storage          = CASE WHEN patch ? 'drug_storage' THEN patch->'drug_storage' ELSE drug_storage END,
    weed_plants           = CASE WHEN patch ? 'weed_plants' THEN patch->'weed_plants' ELSE weed_plants END,
    weed_progress         = CASE WHEN patch ? 'weed_progress' THEN (patch->>'weed_progress')::int ELSE weed_progress END,
    successful_harvest_kg = CASE WHEN patch ? 'successful_harvest_kg' THEN (patch->>'successful_harvest_kg')::numeric ELSE successful_harvest_kg END,
    failed_harvest_kg     = CASE WHEN patch ? 'failed_harvest_kg' THEN (patch->>'failed_harvest_kg')::numeric ELSE failed_harvest_kg END,
    breakout_skill        = CASE WHEN patch ? 'breakout_skill' THEN (patch->>'breakout_skill')::numeric ELSE breakout_skill END,
    heat                  = CASE WHEN patch ? 'heat' THEN LEAST(100, GREATEST(0, (patch->>'heat')::int)) ELSE heat END,
    bullets               = CASE WHEN patch ? 'bullets' THEN GREATEST(0, (patch->>'bullets')::bigint) ELSE bullets END,
    heist_gear            = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;

-- ---------- 19c) Self: travel between cities ----------
CREATE OR REPLACE FUNCTION public.travel_to_city(city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  cost bigint := 380;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.current_city = city THEN RAISE EXCEPTION 'ALREADY_THERE'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - cost, current_city = city
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'city', city, 'cost', cost);
END;
$$;

-- ---------- 19d) Self: buy bullets at the Metal Factory ----------
-- Server-side police risk: buying > 5000 at once gets you caught.
CREATE OR REPLACE FUNCTION public.buy_bullets(amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  price_per_bullet bigint := 5;
  total_cost bigint;
  fine bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount < 10 THEN RAISE EXCEPTION 'MIN_10_BULLETS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF amount > 5000 THEN
    -- Police bust: fine, heat, confiscation
    fine := floor(amount * 0.8)::bigint;
    UPDATE public.players
    SET cash = GREATEST(0, cash - fine),
        heat = LEAST(100, COALESCE(heat, 0) + 30),
        bullets = GREATEST(0, COALESCE(bullets, 0) - floor(amount * 0.6)::bigint)
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'busted', true, 'fine', fine);
  END IF;

  total_cost := amount * price_per_bullet;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      bullets = COALESCE(bullets, 0) + amount
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'bullets_bought', amount, 'cost', total_cost);
END;
$$;

-- ---------- 19d2) Self: skill-based jail escape attempt ----------
-- Success chance = breakout_skill%. Fail adds 5 minutes.
CREATE OR REPLACE FUNCTION public.attempt_breakout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF p.jailed_until IS NULL OR p.jailed_until <= now() THEN
    RAISE EXCEPTION 'NOT_IN_JAIL';
  END IF;

  IF random() < COALESCE(p.breakout_skill, 10) / 100.0 THEN
    UPDATE public.players SET jailed_until = NULL WHERE id = p.id;
    RETURN jsonb_build_object('success', true);
  ELSE
    UPDATE public.players
    SET jailed_until = jailed_until + make_interval(mins => 5)
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'added_minutes', 5);
  END IF;
END;
$$;

-- ---------- 19e) Read RPCs (players table only allows reading your own row) ----------
-- Admin roster
CREATE OR REPLACE FUNCTION public.admin_list_players(search text DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', id, 'username', username, 'cash', cash, 'power', power,
    'level', level, 'rebirths', rebirths, 'murder_skill', murder_skill,
    'is_donator', is_donator, 'jailed_until', jailed_until,
    'death_until', death_until, 'heat', heat, 'personal_bank', personal_bank
  )
  FROM public.players
  WHERE search IS NULL OR username ILIKE '%' || search || '%'
  ORDER BY cash DESC
  LIMIT 50;
END;
$$;

-- Public profile lookup by username (safe fields only)
CREATE OR REPLACE FUNCTION public.get_public_profile(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT jsonb_build_object(
    'id', id, 'username', username, 'level', level, 'cash', cash,
    'diamonds', diamonds, 'is_donator', is_donator,
    'crimes_succeeded', crimes_succeeded, 'crimes_failed', crimes_failed,
    'family_id', family_id, 'power', power, 'protection', protection,
    'health', health, 'murder_skill', murder_skill,
    'avatar_url', avatar_url, 'bio', bio
  ) INTO result
  FROM public.players
  WHERE username ILIKE p_username
  LIMIT 1;

  IF result IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  RETURN result;
END;
$$;

-- PvP target list (top players by power, safe fields only)
CREATE OR REPLACE FUNCTION public.list_pvp_targets()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', id, 'username', username, 'level', level,
    'power', power, 'murder_skill', murder_skill
  )
  FROM public.players
  WHERE id <> auth.uid()
  ORDER BY power DESC
  LIMIT 8;
END;
$$;

-- ---------- 19b) Admin: nudge a stock price (market mover events) ----------
CREATE OR REPLACE FUNCTION public.admin_nudge_stock(p_ticker text, pct numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cur numeric;
  new_price numeric;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT current_price INTO cur FROM public.stocks WHERE ticker = p_ticker;
  IF cur IS NULL THEN RAISE EXCEPTION 'STOCK_NOT_FOUND'; END IF;

  new_price := GREATEST(3, round(cur * (1 + pct / 100) * 100) / 100);

  UPDATE public.stocks
  SET prev_price = current_price,
      current_price = new_price,
      last_tick = now()
  WHERE ticker = p_ticker;

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'new_price', new_price);
END;
$$;

-- ---------- 20) Persist the admin's high stats (replaces the
-- client-side stat inflation that caused tracker desync) ----------
UPDATE public.players
SET level = GREATEST(level, 50),
    power = GREATEST(power, 50000),
    murder_skill = GREATEST(murder_skill, 15),
    is_donator = true,
    donator_since = COALESCE(donator_since, now())
WHERE username = 'YGhosty';
