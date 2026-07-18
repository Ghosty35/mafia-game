-- A2) Guarantee the property catalog is fully populated in ALL 5 cities.
--     Migration 092 seeded every type in every city, but if it was never
--     applied (or rows were lost) some cities show empty. This re-inserts
--     idempotently (ON CONFLICT DO NOTHING) so running it is safe.
-- A3) Murder cooldown = 65 minutes on BOTH success and failure (was 1h normal,
--     10min on bodyguard-block). Matches the requested "1 hour and 5 min".
-- =====================================================================

-- A1 helper: prepend an entry and keep only the last 10.
CREATE OR REPLACE FUNCTION public._append_txn(
  p_id uuid, icon text, "desc" text, amount bigint, tax bigint DEFAULT 0
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cur jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(transaction_log, '[]'::jsonb) INTO cur FROM public.players WHERE id = p_id;
  cur := jsonb_build_array(
    jsonb_build_object(
      'icon', icon, 'desc', "desc", 'amount', amount,
      'tax', tax, 'at', to_char(now(), 'YYYY-MM-DD HH24:MI')
    )
  ) || cur;
  IF jsonb_array_length(cur) > 10 THEN
    cur := cur -> 0 || cur -> 1 || cur -> 2 || cur -> 3 || cur -> 4
         || cur -> 5 || cur -> 6 || cur -> 7 || cur -> 8 || cur -> 9;
  END IF;
  UPDATE public.players SET transaction_log = cur WHERE id = p_id;
END;
$$;

-- A1: personal bank deposit logs the move.
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
  PERFORM public._append_txn(p.id, 'â¬†ï¸', 'Deposit to bank', amount, tax);
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

-- A1: personal bank withdraw logs the move.
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
  PERFORM public._append_txn(p.id, 'â¬‡ï¸', 'Withdraw from bank', -amount, tax);
  RETURN jsonb_build_object('player', to_jsonb(p));
END;
$$;

-- A3: murder cooldown -> 65 minutes on every outcome.
CREATE OR REPLACE FUNCTION public.attempt_murder(target_username text, weapon text, bullets_used integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  attacker_level int;
  attacker_skill numeric;
  stat_edge numeric;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.05;
  heat_gain int := 20;
  cooldown_end timestamptz;
  interval_sec int := public._action_interval_seconds();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF attacker.last_action_at IS NOT NULL AND attacker.last_action_at > (now() - make_interval(secs => interval_sec)) THEN
    RAISE EXCEPTION 'TOO_FAST';
  END IF;
  SELECT * INTO target FROM public.players WHERE username = target_username FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF attacker.id = target.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF attacker.murder_cooldown IS NOT NULL AND attacker.murder_cooldown > now() THEN
    RAISE EXCEPTION 'ON_MURDER_COOLDOWN';
  END IF;
  attacker_level := attacker.level;
  attacker_skill := COALESCE(attacker.murder_skill, 0);
  IF attacker_level < 16 OR attacker_skill < 10 THEN
    RAISE EXCEPTION 'MURDER_LOCKED';
  END IF;
  attacker.stamina := public._spend_stamina(attacker.id, 15);
  attacker.bullets := GREATEST(0, COALESCE(attacker.bullets, 0) - bullets_used);
  IF COALESCE(target.bodyguards, 0) > 0 THEN
    UPDATE public.players SET bodyguards = bodyguards - 1 WHERE id = target.id;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 10);
    cooldown_end := now() + interval '65 minutes';
    attacker.murder_cooldown := cooldown_end;
    attacker.last_action_at := now();
    UPDATE public.players SET
      heat = attacker.heat, heat_updated_at = now(),
      bullets = attacker.bullets, murder_cooldown = attacker.murder_cooldown,
      last_action_at = attacker.last_action_at
    WHERE id = attacker.id;
    RETURN jsonb_build_object(
      'success', false, 'blocked', true, 'stolen', 0,
      'guards_left', COALESCE(target.bodyguards, 0) - 1,
      'cooldown_until', cooldown_end, 'stamina', attacker.stamina,
      'player', to_jsonb(attacker)
    );
  END IF;
  success_chance := LEAST(90, GREATEST(10, attacker_skill * 5));
  IF attacker_skill >= 15 THEN success_chance := success_chance + 15; END IF;
  IF weapon = 'Rifle' THEN success_chance := success_chance + 20;
  ELSIF weapon = 'SMG' THEN success_chance := success_chance + 10;
  END IF;
  success_chance := success_chance + LEAST(20, bullets_used / 25);
  stat_edge := LEAST(15, GREATEST(-15, (COALESCE(attacker.strength, 10) - COALESCE(target.defense, 10)) / 2.0));
  success_chance := success_chance + stat_edge;
  succeeded := random() < (success_chance / 100);
  IF succeeded THEN
    stolen := FLOOR(target.cash * 0.2);
    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := COALESCE(attacker.murder_skill, 0) + skill_gain;
    PERFORM public.record_hustler_progress('murder', 1);
    PERFORM public.bump_player_stat('murder');
    heat_gain := 15;
  ELSE
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain + 10);
  END IF;
  attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + heat_gain);
  cooldown_end := now() + interval '65 minutes';
  attacker.murder_cooldown := cooldown_end;
  attacker.last_action_at := now();
  UPDATE public.players SET
    dirty_cash = attacker.dirty_cash,
    murder_skill = attacker.murder_skill,
    heat = attacker.heat,
    heat_updated_at = now(),
    bullets = attacker.bullets,
    murder_cooldown = attacker.murder_cooldown,
    last_action_at = attacker.last_action_at
  WHERE id = attacker.id;
  IF succeeded THEN
    target.cash := GREATEST(0, target.cash - stolen);
    UPDATE public.players SET cash = target.cash WHERE id = target.id;
  END IF;
  RETURN jsonb_build_object(
    'success', succeeded,
    'stolen', COALESCE(stolen, 0),
    'skill_gained', CASE WHEN succeeded THEN skill_gain ELSE 0 END,
    'cooldown_until', cooldown_end,
    'stamina', attacker.stamina,
    'player', to_jsonb(attacker)
  );
END;
$function$;

-- A2: re-seed the full catalog in all 5 cities (idempotent).
INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots) VALUES
  ('villa_ny',    'Villa',           'villa',   'residential', 'New York',     75000,  120, 4),
  ('mansion_ny',  'Mansion',         'mansion', 'residential', 'New York',   1500000,  300, 8),
  ('house_chi',   'House',           'house',   'residential', 'Chicago',     15500,   41, 2),
  ('mansion_chi', 'Mansion',         'mansion', 'residential', 'Chicago',   1500000,  300, 8),
  ('villa_la',    'Villa',           'villa',   'residential', 'Los Angeles',  75000,  120, 4),
  ('house_la',    'House',           'house',   'residential', 'Los Angeles', 16000,   42, 2),
  ('mansion_la',  'Mansion',         'mansion', 'residential', 'Los Angeles',1550000,  295, 8),
  ('villa_mi',    'Villa',           'villa',   'residential', 'Miami',       78000,  125, 4),
  ('house_mi',    'House',           'house',   'residential', 'Miami',       15200,   39, 2),
  ('mansion_mi',  'Mansion',         'mansion', 'residential', 'Miami',     1500000,  300, 8),
  ('house_lv',    'House',           'house',   'residential', 'Las Vegas',   15000,   40, 2),
  ('villa_lv',    'Villa',           'villa',   'residential', 'Las Vegas',   82000,  130, 4),
  ('mansion_lv',  'Mansion',         'mansion', 'residential', 'Las Vegas', 1500000,  300, 8),
  ('ts_ny',  'Train Station',    'agency', 'agency', 'New York',     25000,  100, 0),
  ('ts_chi', 'Train Station',    'agency', 'agency', 'Chicago',      25000,  100, 0),
  ('ts_la',  'Train Station',    'agency', 'agency', 'Los Angeles',  25000,  100, 0),
  ('ts_mi',  'Train Station',    'agency', 'agency', 'Miami',        25000,  100, 0),
  ('ts_lv',  'Train Station',    'agency', 'agency', 'Las Vegas',    25000,  100, 0),
  ('mf_ny',  'Metal Factory',   'agency', 'agency', 'New York',     45000,  240, 0),
  ('mf_chi', 'Metal Factory',   'agency', 'agency', 'Chicago',      45000,  240, 0),
  ('mf_la',  'Metal Factory',   'agency', 'agency', 'Los Angeles',  45000,  240, 0),
  ('mf_mi',  'Metal Factory',   'agency', 'agency', 'Miami',        45000,  240, 0),
  ('mf_lv',  'Metal Factory',   'agency', 'agency', 'Las Vegas',    45000,  240, 0),
  ('da_ny',  'Detective Agency','agency', 'agency', 'New York',     30000,  160, 0),
  ('da_chi', 'Detective Agency','agency', 'agency', 'Chicago',      30000,  160, 0),
  ('da_la',  'Detective Agency','agency', 'agency', 'Los Angeles',  30000,  160, 0),
  ('da_mi',  'Detective Agency','agency', 'agency', 'Miami',        30000,  160, 0),
  ('da_lv',  'Detective Agency','agency', 'agency', 'Las Vegas',    30000,  160, 0),
  ('h_ny',  'Hospital',        'agency', 'agency', 'New York',     35000,  180, 0),
  ('h_chi', 'Hospital',        'agency', 'agency', 'Chicago',      35000,  180, 0),
  ('h_la',  'Hospital',        'agency', 'agency', 'Los Angeles',  35000,  180, 0),
  ('h_mi',  'Hospital',        'agency', 'agency', 'Miami',        35000,  180, 0),
  ('h_lv',  'Hospital',        'agency', 'agency', 'Las Vegas',    35000,  180, 0),
  ('gb_ny',  'General Bank',   'agency', 'agency', 'New York',     80000,  400, 0),
  ('gb_chi', 'General Bank',   'agency', 'agency', 'Chicago',      80000,  400, 0),
  ('gb_la',  'General Bank',   'agency', 'agency', 'Los Angeles',  80000,  400, 0),
  ('gb_mi',  'General Bank',   'agency', 'agency', 'Miami',        80000,  400, 0),
  ('gb_lv',  'General Bank',   'agency', 'agency', 'Las Vegas',    80000,  400, 0),
  ('airport_ny',  'Airport',        'airport',  'agency', 'New York',    3000000,  800, 0),
  ('airport_chi', 'Airport',        'airport',  'agency', 'Chicago',     3000000,  800, 0),
  ('airport_la',  'Airport',        'airport',  'agency', 'Los Angeles', 3000000,  800, 0),
  ('airport_mi',  'Airport',        'airport',  'agency', 'Miami',       3000000,  800, 0),
  ('airport_lv',  'Airport',        'airport',  'agency', 'Las Vegas',   3000000,  800, 0),
  ('roulette_ny',  'Roulette',      'casino', 'agency', 'New York',    2500000,  600, 0),
  ('roulette_chi', 'Roulette',      'casino', 'agency', 'Chicago',     2500000,  600, 0),
  ('roulette_la',  'Roulette',      'casino', 'agency', 'Los Angeles', 2500000,  600, 0),
  ('roulette_mi',  'Roulette',      'casino', 'agency', 'Miami',       2500000,  600, 0),
  ('roulette_lv',  'Roulette',      'casino', 'agency', 'Las Vegas',   2500000,  600, 0),
  ('blackjack_ny',  'Blackjack',     'casino', 'agency', 'New York',    2000000,  500, 0),
  ('blackjack_chi', 'Blackjack',     'casino', 'agency', 'Chicago',     2000000,  500, 0),
  ('blackjack_la',  'Blackjack',     'casino', 'agency', 'Los Angeles', 2000000,  500, 0),
  ('blackjack_mi',  'Blackjack',     'casino', 'agency', 'Miami',       2000000,  500, 0),
  ('blackjack_lv',  'Blackjack',     'casino', 'agency', 'Las Vegas',   2000000,  500, 0),
  ('numbers_ny',  'Numbers Game',  'casino', 'agency', 'New York',    800000,  250, 0),
  ('numbers_chi', 'Numbers Game',  'casino', 'agency', 'Chicago',     800000,  250, 0),
  ('numbers_la',  'Numbers Game',  'casino', 'agency', 'Los Angeles', 800000,  250, 0),
  ('numbers_mi',  'Numbers Game',  'casino', 'agency', 'Miami',       800000,  250, 0),
  ('numbers_lv',  'Numbers Game',  'casino', 'agency', 'Las Vegas',   800000,  250, 0),
  ('fruit_ny',  'Fruit Machine', 'casino', 'agency', 'New York',    600000,  200, 0),
  ('fruit_chi', 'Fruit Machine', 'casino', 'agency', 'Chicago',     600000,  200, 0),
  ('fruit_la',  'Fruit Machine', 'casino', 'agency', 'Los Angeles', 600000,  200, 0),
  ('fruit_mi',  'Fruit Machine', 'casino', 'agency', 'Miami',       600000,  200, 0),
  ('fruit_lv',  'Fruit Machine', 'casino', 'agency', 'Las Vegas',   600000,  200, 0),
  ('tuneshop_ny', 'Tuneshop',      'tuneshop', 'agency', 'New York',    700000,  280, 0),
  ('tuneshop_chi','Tuneshop',      'tuneshop', 'agency', 'Chicago',     700000,  280, 0),
  ('tuneshop_la', 'Tuneshop',      'tuneshop', 'agency', 'Los Angeles', 700000,  280, 0),
  ('tuneshop_mi', 'Tuneshop',      'tuneshop', 'agency', 'Miami',       700000,  280, 0),
  ('tuneshop_lv', 'Tuneshop',      'tuneshop', 'agency', 'Las Vegas',   700000,  280, 0),
  ('rld_ny',  'Red Light Dist.', 'redlight', 'agency', 'New York',    1500000,  700, 0),
  ('rld_chi', 'Red Light Dist.', 'redlight', 'agency', 'Chicago',     1500000,  700, 0),
  ('rld_la',  'Red Light Dist.', 'redlight', 'agency', 'Los Angeles', 1500000,  700, 0),
  ('rld_mi',  'Red Light Dist.', 'redlight', 'agency', 'Miami',       1500000,  700, 0),
  ('rld_lv',  'Red Light Dist.', 'redlight', 'agency', 'Las Vegas',   1500000,  700, 0)
ON CONFLICT (id) DO NOTHING;

[
-- ===== MIGRATION 110: Bitch System =====

-- 110_bitch_system.sql
-- =====================================================================
-- Bitch System (Red Light District income engine).
-- ---------------------------------------------------------------------
-- Players buy bitches with CASH (taxed into gov_tax_bank, per project
-- constraint). A bitch works the STREET (15/hr) or, when placed in a
-- city's Red Light District window (20/hr), earns more. Earnings accrue
-- as DIRTY CASH into a per-bitch pending pot, capped at 8h. The owner
-- must CLAIM to move the pot into dirty_cash; unclaimed earnings stop
-- accruing at the cap. Upkeep with Coke (drug_storage) raises loyalty /
-- addiction -> 2x earnings but neglect (low loyalty/health) cuts income
-- and risks death. Rivals can RAID another player to KILL or STEAL a
-- bitch; bodyguards defend.
--
-- Earnings are computed at claim/raid time from LEAST(hours_since_claim,
-- CAP_HOURS) so NO background cron is required.
--
-- Each city has a standalone Red Light District with its own capacity.
-- =====================================================================

-- ---------- A) table ----------
CREATE TABLE IF NOT EXISTS public.player_bitches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  name        text NOT NULL,
  city        text NOT NULL,
  location    text NOT NULL DEFAULT 'street' CHECK (location IN ('street', 'red_light')),
  addicted    boolean NOT NULL DEFAULT false,
  loyalty     int NOT NULL DEFAULT 50 CHECK (loyalty BETWEEN 0 AND 100),
  health      int NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  last_claimed timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_bitches_player_idx ON public.player_bitches(player_id);
CREATE INDEX IF NOT EXISTS player_bitches_city_idx ON public.player_bitches(city, location);
ALTER TABLE public.player_bitches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_bitches_select_own ON public.player_bitches;
CREATE POLICY player_bitches_select_own ON public.player_bitches
  FOR SELECT USING (player_id = auth.uid());
DROP POLICY IF EXISTS player_bitches_modify_own ON public.player_bitches;
CREATE POLICY player_bitches_modify_own ON public.player_bitches
  FOR ALL USING (player_id = auth.uid()) WITH CHECK (player_id = auth.uid());

-- cooldown column for the free "find bitches" action (profile page)
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS last_find_bitches_at timestamptz;

-- ---------- B) constants / helpers ----------
CREATE OR REPLACE FUNCTION public._bitch_rates()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'buy_cost', 25000,
    'buy_tax_rate', 0.02,
    'rl_placement_fee', 5000,
    'street_rate', 15,
    'rl_rate', 20,
    'cap_hours', 8,
    'addicted_mult', 2,
    'rl_cap_total', 50000
  );
$$;

-- pending dirty-cash earnings for one bitch (capped at cap_hours)
CREATE OR REPLACE FUNCTION public._bitch_pending(b public.player_bitches)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  r jsonb := public._bitch_rates();
  rate int := CASE WHEN b.location = 'red_light' THEN (r->>'rl_rate')::int
                   ELSE (r->>'street_rate')::int END;
  cap_hours int := (r->>'cap_hours')::int;
  mult numeric := CASE WHEN b.addicted THEN (r->>'addicted_mult')::numeric ELSE 1 END;
  hrs numeric;
  loyalty_factor numeric;
  health_factor numeric;
BEGIN
  hrs := LEAST(cap_hours, EXTRACT(EPOCH FROM (now() - b.last_claimed)) / 3600.0);
  -- neglect penalty: low loyalty & health cut income
  loyalty_factor := 0.4 + 0.6 * (GREATEST(0, b.loyalty)::numeric / 100.0);
  health_factor  := 0.4 + 0.6 * (GREATEST(0, b.health)::numeric / 100.0);
  RETURN floor(rate * hrs * mult * loyalty_factor * health_factor);
END;
$$;

-- ---------- C) buy a bitch ----------
CREATE OR REPLACE FUNCTION public.buy_bitch(p_city text, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  r jsonb := public._bitch_rates();
  cost bigint := (r->>'buy_cost')::bigint;
  tax bigint;
  nm text;
  bid uuid;
  owned int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT COUNT(*) INTO owned FROM public.player_bitches WHERE player_id = p.id;
  IF owned >= 25 THEN RAISE EXCEPTION 'BITCH_LIMIT'; END IF;

  nm := COALESCE(NULLIF(btrim(p_name), ''), 'Bitch #' || (owned + 1)::text);
  tax := floor(cost * (r->>'buy_tax_rate')::numeric)::bigint;

  INSERT INTO public.player_bitches (player_id, name, city, location)
  VALUES (p.id, nm, p_city, 'street') RETURNING id INTO bid;

  UPDATE public.players
  SET cash = cash - cost,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'bitch_id', bid, 'name', nm, 'cost', cost, 'tax', tax, 'city', p_city);
END;
$$;

-- value of a bitch toward the RLD 50k capacity (its max pending pot)
CREATE OR REPLACE FUNCTION public._bitch_value(b public.player_bitches)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  r jsonb := public._bitch_rates();
  mult numeric := CASE WHEN b.addicted THEN (r->>'addicted_mult')::numeric ELSE 1 END;
  lf numeric := 0.4 + 0.6 * (GREATEST(0, b.loyalty)::numeric / 100.0);
  hf numeric := 0.4 + 0.6 * (GREATEST(0, b.health)::numeric / 100.0);
BEGIN
  RETURN floor((r->>'rl_rate')::int * (r->>'cap_hours')::int * mult * lf * hf);
END;
$$;

-- ---------- D) place / recall in Red Light District ----------
CREATE OR REPLACE FUNCTION public.place_bitch_red_light(p_bitch_id uuid, p_city text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  b public.player_bitches;
  r jsonb := public._bitch_rates();
  cap_total bigint := (r->>'rl_cap_total')::bigint;
  fee bigint := (r->>'rl_placement_fee')::bigint;
  used bigint;
  new_val bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.cash < fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT * INTO b FROM public.player_bitches WHERE id = p_bitch_id AND player_id = p.id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BITCH_NOT_FOUND'; END IF;
  IF b.location = 'red_light' THEN RAISE EXCEPTION 'ALREADY_IN_RL'; END IF;

  -- RLD is full when total value of placed bitches reaches the 50k cap.
  SELECT COALESCE(SUM(public._bitch_value(bb)), 0) INTO used
  FROM public.player_bitches bb WHERE city = p_city AND location = 'red_light';
  new_val := public._bitch_value(b);
  IF used + new_val > cap_total THEN RAISE EXCEPTION 'RL_FULL'; END IF;

  UPDATE public.player_bitches SET location = 'red_light', city = p_city WHERE id = b.id;
  UPDATE public.players SET cash = cash - fee WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'name', b.name, 'city', p_city, 'fee', fee,
                            'used', used + new_val, 'cap', cap_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.recall_bitch(p_bitch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  b public.player_bitches;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO b FROM public.player_bitches WHERE id = p_bitch_id AND player_id = auth.uid() FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BITCH_NOT_FOUND'; END IF;
  IF b.location = 'street' THEN RAISE EXCEPTION 'ALREADY_ON_STREET'; END IF;
  UPDATE public.player_bitches SET location = 'street' WHERE id = b.id;
  RETURN jsonb_build_object('success', true, 'name', b.name);
END;
$$;

-- ---------- E) upkeep with Coke (addiction => 2x earnings) ----------
CREATE OR REPLACE FUNCTION public.feed_bitch(p_bitch_id uuid, p_qty int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  b public.player_bitches;
  have int;
  used int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  have := COALESCE((p.drug_storage->>'Coke')::int, 0);
  IF have <= 0 THEN RAISE EXCEPTION 'NO_COKE'; END IF;
  used := LEAST(p_qty, have);

  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY['Coke'], to_jsonb(have - used));

  SELECT * INTO b FROM public.player_bitches WHERE id = p_bitch_id AND player_id = p.id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'BITCH_NOT_FOUND'; END IF;

  UPDATE public.players SET drug_storage = new_storage WHERE id = p.id;
  UPDATE public.player_bitches
  SET addicted = true,
      loyalty = LEAST(100, b.loyalty + used * 4),
      health  = LEAST(100, b.health + used * 2)
  WHERE id = b.id;

  RETURN jsonb_build_object('success', true, 'name', b.name, 'coke_used', used, 'addicted', true,
                            'loyalty', LEAST(100, b.loyalty + used * 4), 'health', LEAST(100, b.health + used * 2));
END;
$$;

-- ---------- F) claim all pending earnings ----------
-- Street bitches pay the BITCH OWNER (dirty cash). Window (Red Light District)
-- bitches pay the DISTRICT BANK of that city (owned by the redlight property
-- owner). Returns both totals.
CREATE OR REPLACE FUNCTION public.claim_bitch_earnings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  owner_total bigint := 0;
  district_total bigint := 0;
  b public.player_bitches;
  pend bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  FOR b IN SELECT * FROM public.player_bitches WHERE player_id = p.id FOR UPDATE LOOP
    pend := public._bitch_pending(b);
    IF pend > 0 THEN
      IF b.location = 'red_light' THEN
        PERFORM public._prop_bank_credit('rld_' || lower(replace(b.city, ' ', '_')), pend);
        district_total := district_total + pend;
      ELSE
        owner_total := owner_total + pend;
      END IF;
      UPDATE public.player_bitches SET last_claimed = now() WHERE id = b.id;
    END IF;
  END LOOP;

  IF owner_total <= 0 AND district_total <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_CLAIM'; END IF;

  IF owner_total > 0 THEN
    UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + owner_total WHERE id = p.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'owner_earned', owner_total,
    'district_earned', district_total,
    'dirty_cash', COALESCE(p.dirty_cash, 0) + owner_total
  );
END;
$$;

-- ---------- G) read: my bitches + per-city RLD occupancy ----------
CREATE OR REPLACE FUNCTION public.get_my_bitches()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r jsonb := public._bitch_rates();
  bitches jsonb;
  occupancy jsonb;
  pending_total bigint := 0;
  pending_owner bigint := 0;
  pending_district bigint := 0;
  b public.player_bitches;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', bb.id, 'name', bb.name, 'city', bb.city, 'location', bb.location,
      'addicted', bb.addicted, 'loyalty', bb.loyalty, 'health', bb.health,
      'pending', public._bitch_pending(bb),
      'rate', CASE WHEN bb.location = 'red_light' THEN (r->>'rl_rate')::int ELSE (r->>'street_rate')::int END,
      'pot_cap', CASE WHEN bb.location = 'red_light' THEN (r->>'bitch_rl_cap')::int
                      ELSE (r->>'street_rate')::int * (r->>'cap_hours')::int END
    ) ORDER BY bb.created_at
  ), '[]'::jsonb) INTO bitches
  FROM public.player_bitches bb WHERE bb.player_id = auth.uid();

  SELECT COALESCE(jsonb_object_agg(city, used), '{}'::jsonb) INTO occupancy
  FROM (
    SELECT city, COALESCE(SUM(public._bitch_value(bb)), 0)::bigint AS used
    FROM public.player_bitches bb
    WHERE location = 'red_light'
    GROUP BY city
  ) sub;

  FOR b IN SELECT * FROM public.player_bitches WHERE player_id = auth.uid() LOOP
    pending_total := pending_total + public._bitch_pending(b);
    IF b.location = 'red_light' THEN
      pending_district := pending_district + public._bitch_pending(b);
    ELSE
      pending_owner := pending_owner + public._bitch_pending(b);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'bitch_limit', 25,
    'count', (SELECT COUNT(*) FROM public.player_bitches WHERE player_id = auth.uid()),
    'bitch_limit_reached', (SELECT COUNT(*) FROM public.player_bitches WHERE player_id = auth.uid()) >= 25,
    'rl_cap_total', (r->>'rl_cap_total')::bigint,
    'rl_occupancy', occupancy,
    'pending_total', pending_total,
    'pending_owner', pending_owner,
    'pending_district', pending_district,
    'rates', r,
    'bitches', bitches
  );
END;
$$;

-- ---------- H) rival raid: kill or steal a bitch ----------
CREATE OR REPLACE FUNCTION public.raid_bitches(p_target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  attacker public.players;
  target public.players;
  victim_bitch public.player_bitches;
  cd timestamptz;
  success_chance numeric;
  succeeded boolean;
  roll numeric;
  stole boolean := false;
  killed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF attacker.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF attacker.id = (SELECT id FROM public.players WHERE username = p_target_username) THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO target FROM public.players WHERE username = p_target_username FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target.id = attacker.id THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  -- bodyguard block
  IF COALESCE(target.bodyguards, 0) > 0 THEN
    UPDATE public.players SET bodyguards = bodyguards - 1 WHERE id = target.id;
    RETURN jsonb_build_object('success', false, 'blocked', true, 'guards_left', COALESCE(target.bodyguards, 0) - 1,
                              'target', target.username);
  END IF;

  -- need a victim bitch
  SELECT * INTO victim_bitch FROM public.player_bitches WHERE player_id = target.id ORDER BY random() LIMIT 1 FOR UPDATE;
  IF victim_bitch.id IS NULL THEN RAISE EXCEPTION 'TARGET_HAS_NO_BITCHES'; END IF;

  success_chance := LEAST(90, GREATEST(20, 55 + (COALESCE(attacker.level,1) - COALESCE(target.level,1)) * 3));
  succeeded := random() < (success_chance / 100.0);
  roll := random();

  IF succeeded THEN
    IF roll < 0.5 THEN
      -- steal
      DELETE FROM public.player_bitches WHERE id = victim_bitch.id;
      INSERT INTO public.player_bitches (player_id, name, city, location)
      VALUES (attacker.id, victim_bitch.name, attacker.current_city, 'street');
      stole := true;
    ELSE
      -- kill
      DELETE FROM public.player_bitches WHERE id = victim_bitch.id;
      killed := true;
    END IF;
    attacker.heat := LEAST(100, COALESCE(attacker.heat, 0) + 12);
    UPDATE public.players SET heat = attacker.heat, heat_updated_at = now() WHERE id = attacker.id;
  END IF;

  RETURN jsonb_build_object(
    'success', succeeded, 'stole', stole, 'killed', killed,
    'target', target.username, 'bitch_name', victim_bitch.name,
    'new_heat', attacker.heat
  );
END;
$$;

-- ---------- H2) find bitches (profile page icon) ----------
-- The viewer presses "find bitches" on ANOTHER player's profile. This rolls
-- a random 1-5 bitches and adds them to the VIEWER's own street (in the
-- target's city, for flavor). Free but rate-limited to once per hour so it
-- cannot be spammed, and respects the 25-bitch cap.
CREATE OR REPLACE FUNCTION public.find_bitches(p_target_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  target public.players;
  n int;
  i int := 0;
  added int := 0;
  city text;
  nm text;
  bid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  IF p.last_find_bitches_at IS NOT NULL AND p.last_find_bitches_at > (now() - interval '1 hour') THEN
    RAISE EXCEPTION 'FIND_ON_COOLDOWN';
  END IF;

  SELECT * INTO target FROM public.players WHERE username = p_target_username;
  IF target.id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  city := COALESCE(target.current_city, 'New York');

  SELECT COUNT(*) INTO n FROM public.player_bitches WHERE player_id = p.id;
  IF n >= 25 THEN RAISE EXCEPTION 'BITCH_LIMIT'; END IF;

  n := LEAST(25 - n, 1 + floor(random() * 5)::int); -- 1..5, capped by remaining slots

  LOOP
    EXIT WHEN i >= n;
    i := i + 1;
    nm := 'Street ' || (SELECT COUNT(*) + 1 FROM public.player_bitches WHERE player_id = p.id)::text;
    INSERT INTO public.player_bitches (player_id, name, city, location)
    VALUES (p.id, nm, city, 'street') RETURNING id INTO bid;
    added := added + 1;
  END LOOP;

  UPDATE public.players SET last_find_bitches_at = now() WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'added', added, 'city', city, 'target', target.username);
END;
$$;

-- ---------- I) grants ----------
REVOKE ALL ON FUNCTION public._bitch_rates() FROM public, anon;
GRANT EXECUTE ON FUNCTION public._bitch_rates() TO authenticated;
REVOKE ALL ON FUNCTION public._bitch_pending(public.player_bitches) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._bitch_pending(public.player_bitches) TO authenticated;
REVOKE ALL ON FUNCTION public.buy_bitch(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_bitch(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.place_bitch_red_light(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.place_bitch_red_light(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.recall_bitch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recall_bitch(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.feed_bitch(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.feed_bitch(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_bitch_earnings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_bitch_earnings() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_bitches() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_bitches() TO authenticated;
REVOKE ALL ON FUNCTION public.raid_bitches(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.raid_bitches(text) TO authenticated;
REVOKE ALL ON FUNCTION public.find_bitches(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_bitches(text) TO authenticated;

[
-- ===== MIGRATION 111: Per-Property Banks =====

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

