-- 047_family_rbac_and_payout_fixes.sql
-- =====================================================================
-- FASE 1 / Spoor C1 — Family security: RBAC + payout + donator
-- ---------------------------------------------------------------------
-- Sluit de kritieke privilege-escalatie en gratis-VIP gaten:
--   * demote_member : geen rol-validatie -> manager maakt zichzelf 'boss'
--   * promote_member: underboss kon iemand tot 'boss' maken (coup)
--   * grant_donator_status: gratis VIP voor elke ingelogde speler
--   * claim_family_hourly : familie-brede klok -> eerste claimer pakt alles
--
-- Nieuwe rang-gebaseerde regels voor promote/demote:
--   - 'boss' is NOOIT toewijsbaar via deze RPC's (leiderschap = aparte actie)
--   - caller moet de target ÉN de nieuwe rol strikt overtreffen in rang
--   - managers mogen alleen soldier/associate zetten
--   - max 2 managers; geen self-target; target moet in jouw familie zitten
-- =====================================================================

-- ---------- rang-helper ----------
CREATE OR REPLACE FUNCTION public._family_rank(p_role text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'boss'       THEN 6
    WHEN 'underboss'  THEN 5
    WHEN 'accountant' THEN 4
    WHEN 'manager'    THEN 3
    WHEN 'caporegime' THEN 2
    WHEN 'soldier'    THEN 1
    WHEN 'associate'  THEN 0
    ELSE -1   -- onbekende rol
  END;
$$;


-- ---------- gedeelde RBAC-mutatie voor promote + demote ----------
-- Eén bron van waarheid; beide RPC's delegeren hierheen.
CREATE OR REPLACE FUNCTION public._family_set_role(p_target_player_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_family_id uuid;
  target_role text;
  manager_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- 'boss' kan nooit via promote/demote worden toegekend.
  IF p_new_role = 'boss' THEN RAISE EXCEPTION 'CANNOT_ASSIGN_BOSS'; END IF;
  IF public._family_rank(p_new_role) < 0 THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT role INTO my_role FROM public.family_members
  WHERE family_id = my_family_id AND player_id = auth.uid();

  IF NOT (my_role IN ('boss', 'underboss', 'manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_target_player_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_TARGET_SELF'; END IF;

  SELECT family_id, role INTO target_family_id, target_role
  FROM public.family_members WHERE player_id = p_target_player_id;

  IF target_family_id IS NULL OR target_family_id <> my_family_id THEN
    RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY';
  END IF;

  -- Managers mogen alleen de laagste rollen zetten.
  IF my_role = 'manager' AND p_new_role NOT IN ('soldier', 'associate') THEN
    RAISE EXCEPTION 'MANAGERS_CAN_ONLY_MANAGE_LOWER_ROLES';
  END IF;

  -- Je moet zowel de target als de nieuwe rol strikt overtreffen in rang.
  IF public._family_rank(my_role) <= public._family_rank(target_role) THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_EQUAL_OR_HIGHER_RANK';
  END IF;
  IF public._family_rank(my_role) <= public._family_rank(p_new_role) THEN
    RAISE EXCEPTION 'CANNOT_ASSIGN_ROLE_ABOVE_OR_EQUAL_SELF';
  END IF;

  -- Max 2 managers.
  IF p_new_role = 'manager' THEN
    SELECT COUNT(*) INTO manager_count
    FROM public.family_members
    WHERE family_id = my_family_id AND role = 'manager';
    IF manager_count >= 2 THEN RAISE EXCEPTION 'MAX_2_MANAGERS'; END IF;
  END IF;

  UPDATE public.family_members
  SET role = p_new_role
  WHERE family_id = my_family_id AND player_id = p_target_player_id;

  RETURN jsonb_build_object('success', true, 'new_role', p_new_role);
END;
$$;


-- ---------- promote_member / demote_member (delegeren naar de guard) ----------
CREATE OR REPLACE FUNCTION public.promote_member(p_target_player_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public._family_set_role(p_target_player_id, p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.demote_member(p_target_player_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public._family_set_role(p_target_player_id, p_new_role);
END;
$$;


-- ---------- grant_donator_status: admin-only ----------
-- Legitieme spelers krijgen donator via purchase_donator() (diamonds).
-- Deze helper was gratis voor iedereen -> nu achter is_admin().
CREATE OR REPLACE FUNCTION public.grant_donator_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  UPDATE public.players
  SET is_donator = true, donator_since = now()
  WHERE id = auth.uid() AND COALESCE(is_donator, false) = false;

  RETURN jsonb_build_object('success', true, 'is_donator', true);
END;
$$;


-- ---------- claim_family_hourly: per-lid accrual ----------
-- Voorheen: families.last_payout_at werd familie-breed gereset ->
--   de eerste claimer kreeg alles, de rest 'NO_PAY_DUE'.
-- Nu: elke speler heeft een eigen last_family_claim_at.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS last_family_claim_at timestamptz;

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
  last_claim timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id, last_family_claim_at INTO my_family_id, last_claim
  FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id;

  -- Basis per uur uit familie-power + kleine bonus uit bankreserve.
  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
  IF base_hourly > 500 THEN base_hourly := 500; END IF;

  -- Verstreken tijd sinds MIJN laatste claim (per-lid, niet familie-breed).
  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(last_claim, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;

  member_pay := floor(base_hourly * hours_elapsed);
  IF member_pay < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed);
  END IF;

  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;

  UPDATE public.players
  SET cash = cash + pay_cash,
      personal_bank = COALESCE(personal_bank, 0) + pay_bank,
      last_family_claim_at = now(),
      last_active = now()
  WHERE id = auth.uid();

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
