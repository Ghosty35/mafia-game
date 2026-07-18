-- 131_hardening_followups.sql
-- Follow-up hardening after the 130 security lockdown + Kilo TODO review.

-- ---------------------------------------------------------------------
-- 1) Drop the ungated admin_set_tax stub.
-- It is SECURITY DEFINER, executable by anon/authenticated, and has NO
-- is_admin() check — but its body is a no-op (`PERFORM 1`). Harmless today,
-- but a latent escalation trap: anyone filling in the body later would ship a
-- world-writable admin function. It has zero callers (the admin page uses
-- admin_deposit_gov_tax / admin_set_lottery_schedule). Remove it.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_set_tax(text, numeric);

-- ---------------------------------------------------------------------
-- 2) claim_family_hourly: lock the player row to stop a double-claim race.
-- Two concurrent calls both read last_family_claim_at, both compute the
-- payout, and both pay out before either stamps the new timestamp. Adding
-- FOR UPDATE serializes them so the second call sees the fresh timestamp and
-- returns NO_PAY_DUE. (Payout logic unchanged.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_family_hourly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  my_family_id uuid; fam record; hours_elapsed numeric; base_hourly bigint;
  member_pay bigint; pay_bank bigint; pay_cash bigint; last_claim timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  -- Lock the caller's player row for the duration of the claim.
  SELECT family_id, last_family_claim_at INTO my_family_id, last_claim
    FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = my_family_id;
  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
  IF base_hourly > 500 THEN base_hourly := 500; END IF;
  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(last_claim, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;
  member_pay := floor(base_hourly * hours_elapsed);
  IF member_pay < 1 THEN RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed); END IF;
  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;
  UPDATE public.players
  SET cash = cash + pay_cash, personal_bank = COALESCE(personal_bank, 0) + pay_bank, last_family_claim_at = now(), last_active = now()
  WHERE id = auth.uid();
  RETURN jsonb_build_object('success', true, 'hours', round(hours_elapsed, 1), 'total_pay', member_pay, 'bank_deposit', pay_bank, 'cash_deposit', pay_cash, 'family_power', fam.power);
END;
$function$;
