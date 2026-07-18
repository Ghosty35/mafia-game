-- 102_dead_jail_guards.sql
-- =====================================================================
-- Layer a DEAD guard on top of every user-facing action RPC that already
-- had an IN_JAIL guard but no DEAD check, plus close the remaining P0
-- race (donate_to_family missing FOR UPDATE). DEAD is checked BEFORE
-- IN_JAIL, mirroring the convention used everywhere else (100/101).
-- Bodies are reproduced verbatim from their source migrations with the
-- single added line, so they remain drop-in CREATE OR REPLACE.
-- =====================================================================

-- =====================================================================
-- GARAGE (051) — add DEAD guard
-- =====================================================================

-- ---------- buy ----------
CREATE OR REPLACE FUNCTION public.garage_buy_car(p_catalog_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cc public.car_catalog; new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO cc FROM public.car_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_CAR'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cc.purchase_price THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cc.purchase_price WHERE id = p.id;
  INSERT INTO public.player_cars (player_id, catalog_id, model, base_value)
    VALUES (p.id, cc.id, cc.name, cc.base_value)
    RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'car_id', new_id, 'new_cash', p.cash - cc.purchase_price);
END;
$$;

-- ---------- repair ----------
CREATE OR REPLACE FUNCTION public.garage_repair_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; cost int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  cost := (100 - pc.condition) * 50;
  IF cost <= 0 THEN RETURN jsonb_build_object('success', true, 'noop', true); END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_cars SET condition = 100 WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- ---------- tune ----------
CREATE OR REPLACE FUNCTION public.garage_tune_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; c_cost constant int := 1000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;
  IF pc.condition < 100 THEN RAISE EXCEPTION 'TUNE_NEEDS_REPAIR'; END IF;
  IF pc.tuned THEN RAISE EXCEPTION 'ALREADY_TUNED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < c_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - c_cost WHERE id = p.id;
  UPDATE public.player_cars SET tuned = true WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'cost', c_cost, 'new_cash', p.cash - c_cost);
END;
$$;

-- ---------- buy part ----------
CREATE OR REPLACE FUNCTION public.garage_buy_part(p_car_id uuid, p_part_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players; pc public.player_cars;
  cost int; bonus int; mod_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  CASE p_part_id
    WHEN 'engine'  THEN cost := 2500; bonus := 5; mod_name := 'Engine Upgrade';
    WHEN 'turbo'   THEN cost := 4000; bonus := 8; mod_name := 'Turbo Kit';
    WHEN 'brakes'  THEN cost := 1500; bonus := 3; mod_name := 'Brakes & Suspension';
    WHEN 'bodykit' THEN cost := 1200; bonus := 2; mod_name := 'Bodykit';
    ELSE RAISE EXCEPTION 'UNKNOWN_PART';
  END CASE;

  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_cars SET
    speed_bonus       = LEAST(50, speed_bonus + bonus),
    parts_value_bonus = parts_value_bonus + (cost / 2),
    mods              = mods || to_jsonb(mod_name)
  WHERE id = pc.id;

  RETURN jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- ---------- sell ----------
CREATE OR REPLACE FUNCTION public.garage_sell_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; sale int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;
  IF public._car_locked(pc.id) THEN RAISE EXCEPTION 'CAR_ON_AUCTION'; END IF;

  sale := floor(public._car_value(pc) * pc.condition / 100.0)::int;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  UPDATE public.players SET cash = cash + sale WHERE id = p.id;
  DELETE FROM public.player_cars WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'sale', sale, 'new_cash', p.cash + sale);
END;
$$;

-- ---------- crush ----------
CREATE OR REPLACE FUNCTION public.garage_crush_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; c_bullets constant int := 15;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;
  IF public._car_locked(pc.id) THEN RAISE EXCEPTION 'CAR_ON_AUCTION'; END IF;

  UPDATE public.players SET bullets = COALESCE(bullets,0) + c_bullets WHERE id = auth.uid()
    RETURNING * INTO p;
  DELETE FROM public.player_cars WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'bullets_gained', c_bullets, 'bullets', p.bullets);
END;
$$;

-- ---------- warehouse upgrade ----------
CREATE OR REPLACE FUNCTION public.garage_upgrade_warehouse()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cost int; new_level int; has_gate boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  has_gate := EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.owned_properties)='array' THEN p.owned_properties ELSE '[]'::jsonb END
    ) e WHERE e->>'name' LIKE '%Villa%' OR e->>'name' LIKE '%Mansion%'
  );
  IF NOT has_gate THEN RAISE EXCEPTION 'NEED_VILLA_OR_MANSION'; END IF;

  new_level := COALESCE(p.garage_level,0) + 1;
  cost := 10000 * new_level;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost, garage_level = new_level WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'garage_level', new_level, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- =====================================================================
-- PERSONAL BANK (022) — add DEAD guard
-- =====================================================================

CREATE OR REPLACE FUNCTION public.deposit_personal_bank(amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  p.gov_tax_bank := coalesce(p.gov_tax_bank, 0) + tax;

  UPDATE public.players SET cash = p.cash, personal_bank = p.personal_bank, gov_tax_bank = p.gov_tax_bank WHERE id = p.id;
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_personal_bank(amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  p.gov_tax_bank := coalesce(p.gov_tax_bank, 0) + tax;

  UPDATE public.players SET cash = p.cash, personal_bank = p.personal_bank, gov_tax_bank = p.gov_tax_bank WHERE id = p.id;
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

-- =====================================================================
-- WEED (046) — add DEAD guard to water + harvest
-- =====================================================================

CREATE OR REPLACE FUNCTION public.water_weed_plant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  p public.players;
  success boolean;
  change int;
  new_percent int;
  new_progress int;
  current_quality int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;

  if coalesce(p.weed_progress, 0) >= 5 then
    raise exception 'MAX_PROGRESS';
  end if;

  if p.weed_last_watered is not null and p.weed_last_watered > now() - interval '1 hour' then
    raise exception 'ON_COOLDOWN';
  end if;

  current_quality := coalesce((p.weed_plants->>'quality')::int, 100);

  success := random() > 0.3;
  change := case when success then 15 else -10 end;
  new_percent := greatest(-50, least(200, current_quality + change));
  new_progress := least(5, coalesce(p.weed_progress, 0) + 1);

  update public.players
  set weed_progress = new_progress,
      weed_plants = jsonb_set(coalesce(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(new_percent)),
      weed_last_watered = now()
  where id = p.id;

  return jsonb_build_object(
    'success', success,
    'change', change,
    'new_percent', new_percent,
    'new_progress', new_progress
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.harvest_weed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  has_house   boolean;
  has_villa   boolean;
  has_mansion boolean;
  kg_base int;
  quality int;
  q_mult numeric;
  kg int;
  have int;
  new_storage jsonb;
  cap constant int := 1000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT
    bool_or(lower(el->>'name') LIKE '%house%'   OR lower(el->>'name') LIKE '%villa%' OR lower(el->>'name') LIKE '%mansion%'),
    bool_or(lower(el->>'name') LIKE '%villa%'),
    bool_or(lower(el->>'name') LIKE '%mansion%')
  INTO has_house, has_villa, has_mansion
  FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) AS el;

  IF NOT COALESCE(has_house, false) THEN RAISE EXCEPTION 'NO_GROW_SPOT'; END IF;
  IF COALESCE(p.weed_progress, 0) < 4 THEN RAISE EXCEPTION 'NEED_PROGRESS'; END IF;

  kg_base := CASE WHEN has_mansion THEN 250 WHEN has_villa THEN 120 ELSE 40 END;
  quality := COALESCE((p.weed_plants->>'quality')::int, 100);

  IF quality < 0 THEN
    UPDATE public.players
    SET weed_progress = 0,
        weed_plants = jsonb_set(COALESCE(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(100)),
        failed_harvest_kg = COALESCE(failed_harvest_kg, 0) + kg_base
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'destroyed', true);
  END IF;

  q_mult := GREATEST(0.1, quality::numeric / 100.0);
  kg := floor(kg_base * q_mult)::int;

  have := COALESCE((p.drug_storage->>'Weed')::int, 0);
  IF have + kg > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), '{Weed}', to_jsonb(have + kg));

  UPDATE public.players
  SET weed_progress = 0,
      weed_plants = jsonb_set(COALESCE(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(100)),
      drug_storage = new_storage,
      successful_harvest_kg = COALESCE(successful_harvest_kg, 0) + kg
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'kg', kg, 'quality', quality, 'storage', new_storage);
END;
$$;

-- =====================================================================
-- BREAKOUT (049 / 035) — add DEAD guard to train + attempt
-- =====================================================================

CREATE OR REPLACE FUNCTION public.train_breakout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_cost      constant bigint  := 500;
  c_increment constant numeric := 5;
  c_cap       constant numeric := 100;
  p           public.players;
  new_skill   numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < c_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  new_skill := LEAST(c_cap, COALESCE(p.breakout_skill, 0) + c_increment);

  UPDATE public.players
     SET cash           = cash - c_cost,
         breakout_skill = new_skill
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'success',        true,
    'breakout_skill', new_skill,
    'new_cash',       p.cash - c_cost
  );
END;
$$;

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
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
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

-- =====================================================================
-- STOCK MARKET (034) — add DEAD guard to buy + sell
-- =====================================================================

CREATE OR REPLACE FUNCTION public.buy_stock(p_ticker text, shares int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.players;
  s record;
  cost numeric;
  current_holdings jsonb;
  new_shares int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF shares < 1 THEN RAISE EXCEPTION 'INVALID_SHARES'; END IF;

  SELECT * INTO p FROM public.players WHERE id=auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  SELECT * INTO s FROM public.stocks WHERE ticker = p_ticker;
  IF s.ticker IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STOCK'; END IF;

  cost := s.current_price * shares;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  p.cash := p.cash - cost;
  current_holdings := COALESCE(p.stock_holdings, '{}'::jsonb);
  new_shares := COALESCE((current_holdings->>p_ticker)::int, 0) + shares;
  current_holdings := jsonb_set(current_holdings, ARRAY[p_ticker], to_jsonb(new_shares));

  UPDATE public.players SET cash = p.cash, stock_holdings = current_holdings WHERE id = p.id;
  PERFORM add_to_casino_pool('general', FLOOR(cost * 0.005));

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'shares_bought', shares, 'cost', cost, 'player', to_jsonb(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.sell_stock(p_ticker text, shares int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.players;
  s record;
  revenue numeric;
  current_holdings jsonb;
  owned int;
  new_shares int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF shares < 1 THEN RAISE EXCEPTION 'INVALID_SHARES'; END IF;

  SELECT * INTO p FROM public.players WHERE id=auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  SELECT * INTO s FROM public.stocks WHERE ticker = p_ticker;
  IF s.ticker IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STOCK'; END IF;

  current_holdings := COALESCE(p.stock_holdings, '{}'::jsonb);
  owned := COALESCE((current_holdings->>p_ticker)::int, 0);
  IF owned < shares THEN RAISE EXCEPTION 'NOT_ENOUGH_SHARES'; END IF;

  revenue := s.current_price * shares;
  p.cash := p.cash + revenue;
  new_shares := owned - shares;
  IF new_shares <= 0 THEN
    current_holdings := current_holdings - p_ticker;
  ELSE
    current_holdings := jsonb_set(current_holdings, ARRAY[p_ticker], to_jsonb(new_shares));
  END IF;

  UPDATE public.players SET cash = p.cash, stock_holdings = current_holdings WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'ticker', p_ticker, 'shares_sold', shares, 'revenue', revenue, 'player', to_jsonb(p));
END;
$$;

-- =====================================================================
-- FAMILY (009 / 012 / 015) — add DEAD guard + FOR UPDATE to donate
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_family(
  p_name text,
  p_tag text,
  p_description text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_family public.families;
  my_family_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_IN_FAMILY'; END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN RAISE EXCEPTION 'INVALID_FAMILY_NAME'; END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN RAISE EXCEPTION 'INVALID_FAMILY_TAG'; END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN RAISE EXCEPTION 'FAMILY_NAME_TAKEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN RAISE EXCEPTION 'FAMILY_TAG_TAKEN'; END IF;

  -- Dead players can't start families.
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  INSERT INTO public.families (name, tag, description) VALUES (trim(p_name), upper(trim(p_tag)), p_description) RETURNING * INTO new_family;
  INSERT INTO public.family_members (family_id, player_id, role) VALUES (new_family.id, auth.uid(), 'boss');
  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  RETURN to_jsonb(new_family);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_family()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p        public.players;
  v_fam_id uuid;
  v_role   text;
  v_fee    bigint;
  v_others int;
  v_expires timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  v_fam_id := p.family_id;

  SELECT role INTO v_role FROM public.family_members WHERE family_id = v_fam_id AND player_id = p.id;
  SELECT count(*) - 1 INTO v_others FROM public.family_members WHERE family_id = v_fam_id;

  -- A boss can't abandon a crew that still has members: hand the seat over first.
  IF v_role = 'boss' AND v_others > 0 THEN
    RAISE EXCEPTION 'BOSS_MUST_HAND_OVER';
  END IF;

  v_fee := least(5000000, greatest(25000,
             floor((coalesce(p.cash,0) + coalesce(p.personal_bank,0)) * 0.05)::bigint));

  IF coalesce(p.cash,0) < v_fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - v_fee, family_id = null WHERE id = p.id;

  DELETE FROM public.family_members WHERE family_id = v_fam_id AND player_id = p.id;

  -- The last one out doesn't get hunted by an empty room.
  IF v_others > 0 THEN
    v_expires := now() + interval '7 days';
    DELETE FROM public.family_bounties WHERE target_id = p.id AND claimed_by IS NULL;
    INSERT INTO public.family_bounties (target_id, family_id, amount, expires_at)
    VALUES (p.id, v_fam_id, v_fee, v_expires);
    PERFORM public._log_event_named(
      p.username, 'bounty',
      'walked out on the family — ' || p.username || ' has a $' || v_fee || ' bounty on their head'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'fee', v_fee,
    'bounty_placed', v_others > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_member(
  p_target_player_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_role text;
  target_family_id uuid;
  my_rank int;
  target_rank int;
  new_rank int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF my_role != 'boss' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT family_id, role INTO target_family_id, target_role FROM public.family_members WHERE player_id = p_target_player_id;
  IF target_family_id IS NULL OR target_family_id != my_family_id THEN RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY'; END IF;
  IF p_target_player_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_PROMOTE_SELF'; END IF;

  my_rank := case my_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  target_rank := case target_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  new_rank := case p_new_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;

  IF new_rank <= my_rank THEN RAISE EXCEPTION 'CANNOT_PROMOTE_ABOVE_YOUR_RANK'; END IF;
  IF target_rank < my_rank THEN RAISE EXCEPTION 'CANNOT_PROMOTE_HIGHER_RANK'; END IF;

  UPDATE public.family_members SET role = p_new_role WHERE family_id = my_family_id AND player_id = p_target_player_id;
  RETURN jsonb_build_object('success', true, 'player_id', p_target_player_id, 'new_role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.demote_member(
  p_target_player_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_role text;
  target_family_id uuid;
  my_rank int;
  target_rank int;
  new_rank int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF my_role != 'boss' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT family_id, role INTO target_family_id, target_role FROM public.family_members WHERE player_id = p_target_player_id;
  IF target_family_id IS NULL OR target_family_id != my_family_id THEN RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY'; END IF;
  IF p_target_player_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_DEMOTE_SELF'; END IF;

  my_rank := case my_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  target_rank := case target_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;
  new_rank := case p_new_role when 'boss' then 1 when 'underboss' then 2 when 'caporegime' then 3 when 'soldier' then 4 else 5 end;

  IF new_rank <= my_rank THEN RAISE EXCEPTION 'CANNOT_DEMOTE_TO_HIGHER_OR_EQUAL'; END IF;
  IF target_rank > my_rank THEN RAISE EXCEPTION 'CANNOT_DEMOTE_LOWER_RANK'; END IF;

  UPDATE public.family_members SET role = p_new_role WHERE family_id = my_family_id AND player_id = p_target_player_id;
  RETURN jsonb_build_object('success', true, 'player_id', p_target_player_id, 'new_role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.kick_member(p_target_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_family_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF my_role NOT IN ('boss', 'underboss') THEN RAISE EXCEPTION 'NOT_AUTHORIZED_TO_KICK'; END IF;

  SELECT family_id INTO target_family_id FROM public.family_members WHERE player_id = p_target_player_id;
  IF target_family_id IS NULL OR target_family_id != my_family_id THEN RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY'; END IF;
  IF p_target_player_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_KICK_SELF'; END IF;

  DELETE FROM public.family_members WHERE family_id = my_family_id AND player_id = p_target_player_id;
  UPDATE public.players SET family_id = NULL WHERE id = p_target_player_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- donate_to_family: close P0 race — FOR UPDATE on player cash + family bank, and DEAD guard.
CREATE OR REPLACE FUNCTION public.donate_to_family(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  p public.players;
  fam public.families;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  -- Atomic: only deduct if player still has the cash (re-checked under lock).
  UPDATE public.players SET cash = cash - amount WHERE id = p.id AND cash >= amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.families SET pending_bank = pending_bank + amount WHERE id = my_family_id;

  RETURN jsonb_build_object('success', true, 'donated', amount, 'status', 'pending');
END;
$$;

-- =====================================================================
-- MESSAGES / TICKETS (072 / 081) — add DEAD guard
-- =====================================================================

CREATE OR REPLACE FUNCTION public.send_player_message(target_username text, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me public.players;
  target_id uuid;
  last_sent timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'EMPTY_MESSAGE'; END IF;
  IF length(p_body) > 500 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

  SELECT * INTO me FROM public.players WHERE id = auth.uid();
  IF me.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF me.death_until IS NOT NULL AND me.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT id INTO target_id FROM public.players WHERE username = target_username;
  IF target_id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target_id = me.id THEN RAISE EXCEPTION 'CANNOT_MESSAGE_SELF'; END IF;

  SELECT created_at INTO last_sent FROM public.messages WHERE from_player_id = me.id ORDER BY created_at DESC LIMIT 1;
  IF last_sent IS NOT NULL AND now() < last_sent + interval '10 seconds' THEN RAISE EXCEPTION 'MESSAGE_TOO_FAST'; END IF;

  INSERT INTO public.messages (from_player_id, to_player_id, subject, body) VALUES (me.id, target_id, 'dm', btrim(p_body));
  RETURN jsonb_build_object('success', true, 'to', target_username);
END;
$$;

CREATE OR REPLACE FUNCTION public.open_ticket(
  p_kind text,
  p_subject text,
  p_body text,
  p_target_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_target uuid;
  v_id     uuid;
  v_open   int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_kind not in ('support','bug','report') then raise exception 'INVALID_KIND'; end if;
  if p_subject is null or length(trim(p_subject)) < 3 then raise exception 'SUBJECT_TOO_SHORT'; end if;
  if p_body is null or length(trim(p_body)) < 3 then raise exception 'BODY_TOO_SHORT'; end if;
  if length(p_subject) > 120 or length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;

  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;

  if p_kind = 'report' then
    if p_target_username is null then raise exception 'TARGET_REQUIRED'; end if;
    select id into v_target from public.players where username ilike p_target_username;
    if v_target is null then raise exception 'TARGET_NOT_FOUND'; end if;
    if v_target = p.id then raise exception 'CANNOT_REPORT_SELF'; end if;
  end if;

  select count(*) into v_open from public.tickets where player_id = p.id and status <> 'closed';
  if v_open >= 5 then raise exception 'TOO_MANY_OPEN'; end if;

  insert into public.tickets (player_id, kind, subject, body, target_id) values (p.id, p_kind, trim(p_subject), trim(p_body), v_target) returning id into v_id;
  return jsonb_build_object('success', true, 'ticket_id', v_id, 'kind', p_kind);
end;
$$;

CREATE OR REPLACE FUNCTION public.reply_ticket(p_ticket_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  t public.tickets;
  p public.players;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_body is null or length(trim(p_body)) < 1 then raise exception 'BODY_TOO_SHORT'; end if;
  if length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;

  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  if p.death_until is not null and p.death_until > now() then raise exception 'DEAD'; end if;

  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if t.player_id <> auth.uid() and not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if t.status = 'closed' then raise exception 'TICKET_CLOSED'; end if;

  insert into public.ticket_replies (ticket_id, author_id, is_staff, body) values (p_ticket_id, auth.uid(), public.is_admin(), trim(p_body));
  update public.tickets set updated_at = now(), status = case when public.is_admin() then 'answered' else 'open' end where id = p_ticket_id;
  return jsonb_build_object('success', true);
end;
$$;

-- =====================================================================
-- CASINO (079 / 080) — add DEAD guard (IN_JAIL already present)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bj_hit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  h public.casino_hands;
  v_card int;
  v_pv int;
  v_state text := 'active';
  v_result text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO h FROM public.casino_hands
   WHERE player_id = auth.uid() AND game = 'blackjack' AND state = 'active' FOR UPDATE;
  IF h.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_HAND'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  v_card := h.deck[1];
  h.deck := h.deck[2:array_length(h.deck,1)];
  h.player_cards := h.player_cards || v_card;
  v_pv := public._bj_value(h.player_cards);

  IF v_pv > 21 THEN
    v_state := 'done'; v_result := 'bust';
    PERFORM public.add_to_casino_pool('blackjack', h.bet);
  END IF;

  UPDATE public.casino_hands SET deck = h.deck, player_cards = h.player_cards, state = v_state, result = v_result WHERE id = h.id;
  RETURN jsonb_build_object(
    'hand_id', h.id, 'player_cards', h.player_cards, 'player_value', v_pv,
    'dealer_cards', CASE WHEN v_state = 'done' THEN to_jsonb(h.dealer_cards) ELSE to_jsonb(array[h.dealer_cards[1]]) END,
    'dealer_value', CASE WHEN v_state = 'done' THEN public._bj_value(h.dealer_cards) ELSE null END,
    'state', v_state, 'result', v_result, 'payout', 0,
    'new_cash', (SELECT cash FROM public.players WHERE id = auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bj_stand()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  h public.casino_hands;
  v_pv int; v_dv int;
  v_result text; v_payout bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO h FROM public.casino_hands
   WHERE player_id = auth.uid() AND game = 'blackjack' AND state = 'active' FOR UPDATE;
  IF h.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_HAND'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  v_pv := public._bj_value(h.player_cards);
  v_dv := public._bj_value(h.dealer_cards);
  WHILE v_dv < 17 LOOP
    h.dealer_cards := h.dealer_cards || h.deck[1];
    h.deck := h.deck[2:array_length(h.deck,1)];
    v_dv := public._bj_value(h.dealer_cards);
  END LOOP;

  IF v_dv > 21 OR v_pv > v_dv THEN v_result := 'win'; v_payout := h.bet * 2;
  ELSIF v_pv = v_dv THEN v_result := 'push'; v_payout := h.bet;
  ELSE v_result := 'lose'; v_payout := 0; END IF;

  IF v_payout > 0 THEN UPDATE public.players SET cash = cash + v_payout WHERE id = auth.uid();
  ELSE PERFORM public.add_to_casino_pool('blackjack', h.bet); END IF;

  UPDATE public.casino_hands SET deck = h.deck, dealer_cards = h.dealer_cards, state = 'done', result = v_result, payout = v_payout WHERE id = h.id;
  RETURN jsonb_build_object(
    'hand_id', h.id, 'player_cards', h.player_cards, 'player_value', v_pv,
    'dealer_cards', h.dealer_cards, 'dealer_value', v_dv, 'state', 'done', 'result', v_result,
    'payout', v_payout, 'profit', v_payout - h.bet, 'new_cash', (SELECT cash FROM public.players WHERE id = auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.vp_draw(p_holds int[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  h        public.casino_hands;
  v_final  int[] := '{}';
  v_i      int;
  v_next   int := 1;
  v_hand   text;
  v_mult   int;
  v_payout bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO h FROM public.casino_hands
   WHERE player_id = auth.uid() AND game = 'vpoker' AND state = 'active' FOR UPDATE;
  IF h.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_HAND'; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND death_until IS NOT NULL AND death_until > now()) THEN
    RAISE EXCEPTION 'DEAD';
  END IF;

  IF p_holds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_holds) x WHERE x < 1 OR x > 5) THEN RAISE EXCEPTION 'INVALID_HOLDS'; END IF;

  FOR v_i IN 1..5 LOOP
    IF p_holds IS NOT NULL AND v_i = ANY(p_holds) THEN v_final := v_final || h.player_cards[v_i];
    ELSE v_final := v_final || h.deck[v_next]; v_next := v_next + 1; END IF;
  END LOOP;

  v_hand := public._vp_evaluate(v_final);
  v_mult := public._vp_multiplier(v_hand);
  v_payout := h.bet * v_mult;

  IF v_payout > 0 THEN UPDATE public.players SET cash = cash + v_payout WHERE id = auth.uid();
  ELSE PERFORM public.add_to_casino_pool('general', h.bet); END IF;

  UPDATE public.casino_hands SET player_cards = v_final, deck = h.deck[v_next:array_length(h.deck,1)], state = 'done', result = v_hand, payout = v_payout WHERE id = h.id;
  RETURN jsonb_build_object(
    'hand_id', h.id, 'cards', v_final, 'hand', v_hand, 'multiplier', v_mult, 'bet', h.bet,
    'payout', v_payout, 'profit', v_payout - h.bet, 'state', 'done', 'new_cash', (SELECT cash FROM public.players WHERE id = auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.roulette_spin(p_bet_type text, p_bet_value int, p_bet bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  p        public.players;
  v_n      int;
  v_red    boolean;
  v_won    boolean := false;
  v_mult   int := 0;
  v_payout bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_bet < 100 OR p_bet > 500000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < p_bet THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  IF p_bet_type = 'straight' THEN
    IF p_bet_value IS NULL OR p_bet_value < 0 OR p_bet_value > 36 THEN RAISE EXCEPTION 'INVALID_BET_VALUE'; END IF;
  ELSIF p_bet_type IN ('dozen','column') THEN
    IF p_bet_value IS NULL OR p_bet_value < 1 OR p_bet_value > 3 THEN RAISE EXCEPTION 'INVALID_BET_VALUE'; END IF;
  ELSIF p_bet_type NOT IN ('red','black','odd','even','low','high') THEN
    RAISE EXCEPTION 'INVALID_BET_TYPE';
  END IF;

  v_n := floor(random() * 37)::int;
  v_red := public._roulette_is_red(v_n);

  IF p_bet_type = 'straight' THEN v_won := (v_n = p_bet_value); v_mult := 36;
  ELSIF v_n = 0 THEN v_won := false;
  ELSIF p_bet_type = 'red' THEN v_won := v_red; v_mult := 2;
  ELSIF p_bet_type = 'black' THEN v_won := NOT v_red; v_mult := 2;
  ELSIF p_bet_type = 'odd' THEN v_won := (v_n % 2 = 1); v_mult := 2;
  ELSIF p_bet_type = 'even' THEN v_won := (v_n % 2 = 0); v_mult := 2;
  ELSIF p_bet_type = 'low' THEN v_won := (v_n BETWEEN 1 AND 18); v_mult := 2;
  ELSIF p_bet_type = 'high' THEN v_won := (v_n BETWEEN 19 AND 36); v_mult := 2;
  ELSIF p_bet_type = 'dozen' THEN v_won := (ceil(v_n / 12.0)::int = p_bet_value); v_mult := 3;
  ELSIF p_bet_type = 'column' THEN v_won := (CASE WHEN v_n % 3 = 0 THEN 3 ELSE v_n % 3 END = p_bet_value); v_mult := 3;
  END IF;

  IF v_won THEN
    v_payout := p_bet * v_mult;
    UPDATE public.players SET cash = cash - p_bet + v_payout WHERE id = p.id;
  ELSE
    UPDATE public.players SET cash = cash - p_bet WHERE id = p.id;
    PERFORM public.add_to_casino_pool('roulette', p_bet);
  END IF;

  RETURN jsonb_build_object(
    'number', v_n, 'color', CASE WHEN v_n = 0 THEN 'green' WHEN v_red THEN 'red' ELSE 'black' END,
    'won', v_won, 'bet', p_bet, 'bet_type', p_bet_type, 'bet_value', p_bet_value,
    'payout', v_payout, 'profit', CASE WHEN v_won THEN v_payout - p_bet ELSE -p_bet END,
    'new_cash', (SELECT cash FROM public.players WHERE id = p.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rps_play(p_choice text, p_bet bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  p        public.players;
  v_house  text;
  v_result text;
  v_payout bigint := 0;
  choices  text[] := array['rock','paper','scissors'];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_bet < 100 OR p_bet > 500000 THEN RAISE EXCEPTION 'INVALID_BET'; END IF;
  IF p_choice IS NULL OR p_choice <> ALL(choices) THEN RAISE EXCEPTION 'INVALID_CHOICE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < p_bet THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  v_house := choices[floor(random() * 3)::int + 1];
  IF v_house = p_choice THEN v_result := 'draw'; v_payout := p_bet;
  ELSIF (p_choice = 'rock' AND v_house = 'scissors') OR (p_choice = 'paper' AND v_house = 'rock') OR (p_choice = 'scissors' AND v_house = 'paper') THEN
    v_result := 'win'; v_payout := floor(p_bet * 1.9)::bigint;
  ELSE v_result := 'lose'; v_payout := 0; END IF;

  UPDATE public.players SET cash = cash - p_bet + v_payout WHERE id = p.id;
  IF v_result = 'lose' THEN PERFORM public.add_to_casino_pool('general', p_bet); END IF;

  RETURN jsonb_build_object(
    'result', v_result, 'choice', p_choice, 'house', v_house, 'bet', p_bet,
    'payout', v_payout, 'profit', v_payout - p_bet, 'new_cash', (SELECT cash FROM public.players WHERE id = p.id)
  );
END;
$$;

-- =====================================================================
-- AUCTIONS (082) — add DEAD guard (IN_JAIL already present)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.auction_cancel(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE a public.auctions; p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.seller_id <> auth.uid() THEN RAISE EXCEPTION 'NOT_YOUR_AUCTION'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.current_bidder IS NOT NULL THEN RAISE EXCEPTION 'HAS_BIDS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  UPDATE public.auctions SET status = 'cancelled', settled_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.auction_bid(p_auction_id uuid, p_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_min bigint;
  v_space int;
  v_have  int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._settle_auctions();

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.ends_at <= now() THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.seller_id = p.id THEN RAISE EXCEPTION 'CANNOT_BID_OWN'; END IF;
  IF a.current_bidder = p.id THEN RAISE EXCEPTION 'ALREADY_HIGH_BIDDER'; END IF;

  v_space := public._max_cars(p.id);
  SELECT count(*) INTO v_have FROM public.player_cars WHERE player_id = p.id;
  IF v_have >= v_space THEN RAISE EXCEPTION 'GARAGE_FULL'; END IF;

  v_min := CASE WHEN a.current_bid IS NULL THEN a.start_price ELSE a.current_bid + greatest(100, floor(a.current_bid * 0.05)::bigint) END;
  IF p_amount < v_min THEN RAISE EXCEPTION 'BID_TOO_LOW'; END IF;
  IF p.cash < p_amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - p_amount WHERE id = p.id;
  IF a.current_bidder IS NOT NULL THEN UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder; END IF;

  UPDATE public.auctions SET current_bid = p_amount, current_bidder = p.id, ends_at = greatest(ends_at, now() + interval '2 minutes') WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, p_amount);

  RETURN jsonb_build_object('success', true, 'bid', p_amount, 'min_next', p_amount + greatest(100, floor(p_amount * 0.05)::bigint), 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.auction_buy_now(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p     public.players;
  a     public.auctions;
  v_space int;
  v_have  int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._settle_auctions();

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO a FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF a.status <> 'live' THEN RAISE EXCEPTION 'AUCTION_OVER'; END IF;
  IF a.buy_now IS NULL THEN RAISE EXCEPTION 'NO_BUY_NOW'; END IF;
  IF a.seller_id = p.id THEN RAISE EXCEPTION 'CANNOT_BID_OWN'; END IF;
  IF a.current_bid IS NOT NULL AND a.current_bid >= a.buy_now THEN RAISE EXCEPTION 'BIDDING_PASSED_BUYNOW'; END IF;
  IF p.cash < a.buy_now THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  v_space := public._max_cars(p.id);
  SELECT count(*) INTO v_have FROM public.player_cars WHERE player_id = p.id;
  IF v_have >= v_space THEN RAISE EXCEPTION 'GARAGE_FULL'; END IF;

  UPDATE public.players SET cash = cash - a.buy_now WHERE id = p.id;
  IF a.current_bidder IS NOT NULL THEN UPDATE public.players SET cash = cash + a.current_bid WHERE id = a.current_bidder; END IF;

  UPDATE public.auctions SET current_bid = a.buy_now, current_bidder = p.id, ends_at = now() WHERE id = a.id;
  INSERT INTO public.auction_bids (auction_id, bidder_id, amount) VALUES (a.id, p.id, a.buy_now);
  PERFORM public._settle_auctions();

  RETURN jsonb_build_object('success', true, 'paid', a.buy_now, 'new_cash', (SELECT cash FROM public.players WHERE id = p.id));
END;
$$;
