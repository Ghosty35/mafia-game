-- ============================================================
-- 029: Server Status stats, Family Power + Hourly Pay system, Last active tracking
-- Supports dynamic Online count, Server Status page, Family create cost 2M, hourly payouts 60/40, power for wars
-- ============================================================

-- 1) Track last_active for online / weekly logins
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS last_active timestamptz DEFAULT now();

-- 2) Family power & hourly system
ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS power bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_payout_at timestamptz DEFAULT now();

-- Optional: store a base hourly rate or compute from power. We'll compute dynamically.
-- power directly boosts attack/defense and hourly payouts.

-- 3) Server stats RPC - all dynamic numbers requested
CREATE OR REPLACE FUNCTION public.get_server_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_players int;
  families_count int;
  total_family_members int;
  total_money bigint;
  logged_week int;
  online_now int;
BEGIN
  SELECT COUNT(*) INTO total_players FROM public.players;

  SELECT COUNT(*) INTO families_count FROM public.families;

  SELECT COALESCE(SUM(member_count), 0) INTO total_family_members FROM public.families;

  -- Total money circulation: cash + personal_bank across all
  SELECT COALESCE(SUM(cash) + SUM(COALESCE(personal_bank, 0)), 0) INTO total_money FROM public.players;

  -- Logged in this week (last_active within 7 days)
  SELECT COUNT(*) INTO logged_week 
  FROM public.players 
  WHERE last_active >= now() - interval '7 days';

  -- Online now: active in last 15 minutes (will be updated by get_my_player / actions)
  SELECT COUNT(*) INTO online_now 
  FROM public.players 
  WHERE last_active >= now() - interval '15 minutes';

  RETURN jsonb_build_object(
    'online_people', online_now,
    'logged_in_this_week', logged_week,
    'total_families', families_count,
    'total_family_members', total_family_members,
    'total_money_circulation', total_money,
    'people_registered', total_players
  );
END;
$$;

-- 4) Update get_my_player to touch last_active (so online works)
CREATE OR REPLACE FUNCTION public.get_my_player()
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  IF p.id IS NULL THEN
    INSERT INTO public.players (id, last_active) VALUES (auth.uid(), now()) RETURNING * INTO p;
  ELSE
    -- Touch activity
    UPDATE public.players SET last_active = now() WHERE id = auth.uid();
    SELECT * INTO p FROM public.players WHERE id = auth.uid();
  END IF;

  RETURN p;
END;
$$;

-- 5) Update create_family to require min 2,000,000 cash OR 200 diamonds
-- Deduct cost server-side for security
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
  my_cash bigint;
  my_diamonds int;
  used_diamonds boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Must have username
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id, cash, diamonds INTO my_family_id, my_cash, my_diamonds 
  FROM public.players WHERE id = auth.uid();

  IF my_family_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_FAMILY';
  END IF;

  -- Validate name/tag same as before
  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_NAME';
  END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN
    RAISE EXCEPTION 'FAMILY_NAME_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN
    RAISE EXCEPTION 'FAMILY_TAG_TAKEN';
  END IF;

  -- COST: 2,000,000 cash OR 200 diamonds
  IF my_cash >= 2000000 THEN
    UPDATE public.players SET cash = cash - 2000000 WHERE id = auth.uid();
  ELSIF my_diamonds >= 200 THEN
    UPDATE public.players SET diamonds = diamonds - 200 WHERE id = auth.uid();
    used_diamonds := true;
  ELSE
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS_FOR_FAMILY: Need 2,000,000 cash or 200 diamonds';
  END IF;

  -- Create
  INSERT INTO public.families (name, tag, description, power)
  VALUES (trim(p_name), upper(trim(p_tag)), p_description, 0)
  RETURNING * INTO new_family;

  INSERT INTO public.family_members (family_id, player_id, role)
  VALUES (new_family.id, auth.uid(), 'boss');

  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'family', to_jsonb(new_family),
    'used_diamonds', used_diamonds
  );
END;
$$;

-- 6) Buy family power using family bank (boss/underboss/accountant). Good ratio for wars + hourly.
-- Example: spend 50k bank for +25 power (2000 per power point)
CREATE OR REPLACE FUNCTION public.buy_family_power(spend_amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  fam_bank bigint;
  fam_power bigint;
  power_gain bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT role INTO my_role FROM public.family_members WHERE family_id = my_family_id AND player_id = auth.uid();
  IF NOT (my_role IN ('boss', 'underboss', 'accountant')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_BUY_POWER';
  END IF;

  SELECT bank, power INTO fam_bank, fam_power FROM public.families WHERE id = my_family_id;

  IF spend_amount < 25000 OR spend_amount > fam_bank THEN
    RAISE EXCEPTION 'INVALID_SPEND_AMOUNT';
  END IF;

  -- Ratio: 1 power per ~2000 spent (good for growth: 50k spend = +25 power)
  power_gain := GREATEST(5, floor(spend_amount / 2000));

  UPDATE public.families 
  SET 
    bank = bank - spend_amount,
    power = power + power_gain
  WHERE id = my_family_id;

  RETURN jsonb_build_object(
    'success', true,
    'spent', spend_amount,
    'power_gained', power_gain,
    'new_power', (SELECT power FROM public.families WHERE id = my_family_id)
  );
END;
$$;

-- 7) Claim family hourly pay. 60% to personal_bank, 40% to cash.
-- Pays for hours since last_payout (capped at 48h for safety). Avg pay based on power + bank size.
CREATE OR REPLACE FUNCTION public.claim_family_hourly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  fam record;
  hours_elapsed numeric;
  base_hourly bigint;
  member_pay bigint;
  pay_bank bigint;
  pay_cash bigint;
  total_members int;
  my_cash bigint;
  my_bank bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id;

  -- Compute avg hourly pay per member.
  -- Good ratio: base from power (main growth driver) + small from bank reserves.
  -- Example: power 10000 => ~50$/hr base per member. Bank adds bonus.
  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));

  -- Cap reasonable per hour
  IF base_hourly > 500 THEN base_hourly := 500; END IF;

  -- Time since last payout
  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(fam.last_payout_at, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF; -- safety cap

  -- Number of members
  SELECT member_count INTO total_members FROM public.families WHERE id = my_family_id;
  IF total_members < 1 THEN total_members := 1; END IF;

  member_pay := floor(base_hourly * hours_elapsed);

  IF member_pay < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed);
  END IF;

  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;

  -- Credit player
  SELECT cash, personal_bank INTO my_cash, my_bank FROM public.players WHERE id = auth.uid();
  UPDATE public.players 
  SET 
    cash = cash + pay_cash,
    personal_bank = COALESCE(personal_bank, 0) + pay_bank,
    last_active = now()
  WHERE id = auth.uid();

  -- Update family last payout
  UPDATE public.families SET last_payout_at = now() WHERE id = my_family_id;

  RETURN jsonb_build_object(
    'success', true,
    'hours', round(hours_elapsed, 1),
    'total_pay', member_pay,
    'bank_deposit', pay_bank,
    'cash_deposit', pay_cash,
    'family_power', fam.power
  );
END;
$$;

-- 8) Helper to get family power + hourly preview (usable by members)
CREATE OR REPLACE FUNCTION public.get_family_power_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  fam record;
  hourly bigint;
BEGIN
  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN 
    RETURN jsonb_build_object('in_family', false);
  END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id;

  hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));

  RETURN jsonb_build_object(
    'in_family', true,
    'power', fam.power,
    'bank', fam.bank,
    'hourly_per_member', hourly,
    'last_payout_at', fam.last_payout_at,
    'member_count', fam.member_count
  );
END;
$$;

COMMENT ON FUNCTION public.buy_family_power(bigint) IS 'Bosses spend family bank to buy power. Power boosts Fam Wars attack/defense + member hourly pay.';
COMMENT ON FUNCTION public.claim_family_hourly() IS 'Members claim accrued hourly pay. 60% bank / 40% cash. Based on family power from donations + power buys.';

-- Update families leaderboard to surface power for UI
CREATE OR REPLACE FUNCTION public.get_families_leaderboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'top', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'pos', pos,
          'id', id,
          'name', name,
          'tag', tag,
          'respect', respect,
          'territory', territory,
          'wars_won', wars_won,
          'member_count', member_count,
          'power', COALESCE(power, 0)
        )
        ORDER BY pos
      ),
      '[]'::jsonb
    )
  )
  FROM (
    SELECT 
      *,
      row_number() OVER (ORDER BY respect DESC, power DESC, territory DESC, wars_won DESC, member_count DESC, created_at ASC) AS pos
    FROM public.families
    ORDER BY respect DESC, power DESC, territory DESC, wars_won DESC, member_count DESC, created_at ASC
    LIMIT 50
  ) ranked;
$$;
