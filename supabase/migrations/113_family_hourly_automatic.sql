-- 113_family_hourly_automatic.sql
-- =====================================================================
-- Make family hourly pay AUTOMATIC. There is no cron/edge-function
-- infra in this project, and the established convention is "lazy
-- settlement on read" (heat decay, war resolution, auctions all do
-- this). So we credit due hourly pay inside get_my_player(), which the
-- client calls on every page load / 15s refresh via PlayerContext.
--
-- A member is paid for every full hour since their last_family_claim_at
-- (capped at 48h), using the SAME formula as claim_family_hourly (047):
--   base = max(1, floor(power/200 + bank/500000)), capped 500/hr
--   60% -> personal_bank, 40% -> cash.
-- The old manual claim_family_hourly() is kept (harmless) but no longer
-- required; families/bank page can drop its button.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_my_player()
 RETURNS players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p public.players;
  rate numeric;
  elapsed_h numeric;
  points int;
  upd_heat int;
  upd_stamp timestamptz;
  srate numeric;
  spoints int;
  upd_stam int;
  stam_anchor timestamptz;
  -- family hourly auto-pay locals
  fam record;
  base_hourly bigint;
  hours_elapsed numeric;
  member_pay bigint;
  pay_bank bigint;
  pay_cash bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid();

  IF p.id IS NULL THEN
    INSERT INTO public.players (id, last_active, heat_updated_at, stamina_updated_at)
    VALUES (auth.uid(), now(), now(), now()) RETURNING * INTO p;
    RETURN p;
  END IF;

  -- heat decay (unchanged from 062)
  upd_heat  := COALESCE(p.heat, 0);
  upd_stamp := COALESCE(p.heat_updated_at, now());

  IF upd_heat > 0 THEN
    rate := public._heat_decay_rate(COALESCE(p.is_donator, false), COALESCE(p.has_corrupt_lawyer, false));
    elapsed_h := EXTRACT(EPOCH FROM (now() - upd_stamp)) / 3600.0;
    points := floor(elapsed_h * rate)::int;
    IF points > 0 THEN
      IF points >= upd_heat THEN
        upd_heat := 0;
        upd_stamp := now();
      ELSE
        upd_heat := upd_heat - points;
        upd_stamp := upd_stamp + make_interval(secs => floor((points / rate) * 3600));
      END IF;
    END IF;
  ELSE
    upd_stamp := now();
  END IF;

  -- stamina regen (069)
  upd_stam    := COALESCE(p.stamina, 100);
  stam_anchor := COALESCE(p.stamina_updated_at, now());

  IF upd_stam < 100 THEN
    srate := public._stamina_regen_rate(COALESCE(p.is_donator, false));
    elapsed_h := EXTRACT(EPOCH FROM (now() - stam_anchor)) / 3600.0;
    spoints := floor(elapsed_h * srate)::int;
    IF spoints > 0 THEN
      IF upd_stam + spoints >= 100 THEN
        upd_stam := 100;
        stam_anchor := now();
      ELSE
        upd_stam := upd_stam + spoints;
        stam_anchor := stam_anchor + make_interval(secs => floor((spoints / srate) * 3600));
      END IF;
    END IF;
  ELSE
    stam_anchor := now();
  END IF;

  -- ---- family hourly auto-pay (lazy, on read) ----
  IF p.family_id IS NOT NULL THEN
    SELECT * INTO fam FROM public.families WHERE id = p.family_id;
    IF fam.id IS NOT NULL THEN
      base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
      IF base_hourly > 500 THEN base_hourly := 500; END IF;

      hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p.last_family_claim_at, now() - interval '1 hour'))) / 3600);
      IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;

      IF hours_elapsed >= 1 THEN
        member_pay := floor(base_hourly * hours_elapsed);
        IF member_pay >= 1 THEN
          pay_bank := floor(member_pay * 0.60);
          pay_cash := member_pay - pay_bank;
          UPDATE public.players
          SET cash = cash + pay_cash,
              personal_bank = COALESCE(personal_bank, 0) + pay_bank,
              last_family_claim_at = now(),
              last_active = now()
          WHERE id = p.id;
        ELSE
          -- mark the hour as claimed even if rounding yields <1
          UPDATE public.players SET last_family_claim_at = now() WHERE id = p.id;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.players
     SET heat = upd_heat, heat_updated_at = upd_stamp,
         stamina = upd_stam, stamina_updated_at = stam_anchor,
         last_active = now()
   WHERE id = auth.uid();

  SELECT * INTO p FROM public.players WHERE id = auth.uid();
  RETURN p;
END;
$function$;
