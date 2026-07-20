-- 158_family_transaction_logs.sql
-- Add missing family bank transaction logging for:
--   claim_family_hourly, buy_family_buff_cash, buy_family_buff_diamonds

BEGIN;

-- 1) claim_family_hourly: log the payout deducted from family bank
CREATE OR REPLACE FUNCTION public.claim_family_hourly()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  my_family_id uuid; fam record; hours_elapsed numeric; base_hourly bigint;
  member_pay bigint; pay_bank bigint; pay_cash bigint; last_claim timestamptz;
  hourly_cap bigint := public._cfg('family_hourly_cap', 500)::bigint;
  my_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT family_id, last_family_claim_at, username INTO my_family_id, last_claim, my_username
    FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = my_family_id;
  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
  IF base_hourly > hourly_cap THEN base_hourly := hourly_cap; END IF;
  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(last_claim, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;
  member_pay := floor(base_hourly * hours_elapsed);
  IF member_pay < 1 THEN RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed); END IF;
  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;
  UPDATE public.players
  SET cash = cash + pay_cash, personal_bank = COALESCE(personal_bank, 0) + pay_bank, last_family_claim_at = now(), last_active = now()
  WHERE id = auth.uid();
  PERFORM public._append_family_txn(my_family_id, '💸', 'Hourly payout', member_pay, COALESCE(my_username, 'Unknown'));
  RETURN jsonb_build_object('success', true, 'hours', round(hours_elapsed, 1), 'total_pay', member_pay, 'bank_deposit', pay_bank, 'cash_deposit', pay_cash, 'family_power', fam.power);
END;
$function$;

-- 2) buy_family_buff_cash: log cash power purchase
CREATE OR REPLACE FUNCTION public.buy_family_buff_cash(cost_cash bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
  my_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_cash <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  power_gain := GREATEST(5, FLOOR(cost_cash / 8000));

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost_cash THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT family_id, username INTO fam_id, my_username FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET cash = cash - cost_cash WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  PERFORM public._append_family_txn(fam_id, '⚔️', 'Power purchase (cash)', cost_cash, COALESCE(my_username, 'Unknown'));

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

-- 3) buy_family_buff_diamonds: log diamond power purchase
CREATE OR REPLACE FUNCTION public.buy_family_buff_diamonds(cost_diamonds bigint, p_is_bundle boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
  rate numeric;
  my_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_diamonds <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  rate := CASE WHEN p_is_bundle THEN 4.0 ELSE 1.8 END;
  power_gain := FLOOR(cost_diamonds * rate);

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(p.diamonds, 0) < cost_diamonds THEN RAISE EXCEPTION 'NOT_ENOUGH_DIAMONDS'; END IF;

  SELECT family_id, username INTO fam_id, my_username FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players SET diamonds = diamonds - cost_diamonds WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  PERFORM public._append_family_txn(fam_id, '💎', 'Power purchase (diamonds)', cost_diamonds, COALESCE(my_username, 'Unknown'));

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_family_hourly() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_family_hourly() TO authenticated;

REVOKE ALL ON FUNCTION public.buy_family_buff_cash(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_family_buff_cash(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.buy_family_buff_diamonds(bigint, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_family_buff_diamonds(bigint, boolean) TO authenticated;

COMMIT;
