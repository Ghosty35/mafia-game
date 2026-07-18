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
