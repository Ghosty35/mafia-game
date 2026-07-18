-- 105_group_a_fixes.sql
-- =====================================================================
-- A1) Bank transaction logs for EVERY bank.
--     Personal bank deposits/withdrawals now append to players.transaction_log
--     (the Bank page already renders it but the RPCs never wrote it — so it
--     stayed empty). A shared helper keeps the log at the last 10 entries.
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
  PERFORM public._append_txn(p.id, '⬆️', 'Deposit to bank', amount, tax);
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
  PERFORM public._append_txn(p.id, '⬇️', 'Withdraw from bank', -amount, tax);
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
