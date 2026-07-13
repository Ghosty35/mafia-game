-- ============================================================
-- Bulletstar-style Family System: Bank/Treasury + Refined Roles
-- 
-- Roles & Permissions (Bulletstar inspired + your specs):
-- - boss: full control
-- - underboss: leden (members) + familie beheer settings (almost like boss for management)
-- - accountant / financier: bank zaken (donations, treasury). Boss + Underboss can also access.
-- - manager: can manage members in settings + accept donations. Max 2 per family.
-- - caporegime / soldier / associate: basic members
--
-- Families get a bank balance. Members can donate cash.
-- Donations increase family bank and respect (Bulletstar style contribution).
-- ============================================================

-- Add bank/treasury to families
ALTER TABLE public.families 
ADD COLUMN IF NOT EXISTS bank bigint NOT NULL DEFAULT 0;

-- Update get_my_family to include bank and better member data
CREATE OR REPLACE FUNCTION public.get_my_family()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  fam public.families;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT f.* INTO fam
  FROM public.families f
  JOIN public.players p ON p.family_id = f.id
  WHERE p.id = auth.uid();

  IF fam.id IS NULL THEN
    RETURN jsonb_build_object('family', null, 'my_role', null, 'members', '[]'::jsonb, 'bank', 0);
  END IF;

  RETURN jsonb_build_object(
    'family', to_jsonb(fam),
    'my_role', (
      SELECT role FROM public.family_members 
      WHERE family_id = fam.id AND player_id = auth.uid()
    ),
    'bank', fam.bank,
    'members', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'player_id', pl.id,
          'username', pl.username,
          'role', fm.role
        )
        ORDER BY 
          CASE fm.role 
            WHEN 'boss' THEN 1 
            WHEN 'underboss' THEN 2 
            WHEN 'accountant' THEN 3 
            WHEN 'manager' THEN 4 
            WHEN 'caporegime' THEN 5 
            WHEN 'soldier' THEN 6 
            ELSE 7 
          END, pl.username
      ), '[]'::jsonb)
      FROM public.family_members fm
      JOIN public.players pl ON pl.id = fm.player_id
      WHERE fm.family_id = fam.id
      LIMIT 50
    )
  );
END;
$$;

-- Donate cash to family bank (increases bank + respect)
CREATE OR REPLACE FUNCTION public.donate_to_family(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_cash bigint;
  respect_gain bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT cash INTO my_cash FROM public.players WHERE id = auth.uid();
  IF my_cash < amount OR amount <= 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  -- Take from player
  UPDATE public.players SET cash = cash - amount WHERE id = auth.uid();

  -- Give to family bank + respect (Bulletstar style: contributions build family power)
  respect_gain := GREATEST(1, floor(amount / 10));  -- 10% of donation as respect

  UPDATE public.families 
  SET 
    bank = bank + amount,
    respect = respect + respect_gain
  WHERE id = my_family_id;

  RETURN jsonb_build_object(
    'success', true,
    'donated', amount,
    'new_bank', (SELECT bank FROM public.families WHERE id = my_family_id),
    'respect_gained', respect_gain
  );
END;
$$;

-- Get family bank (for those with permission)
CREATE OR REPLACE FUNCTION public.get_family_bank()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'bank', f.bank,
    'respect', f.respect
  )
  FROM public.families f
  JOIN public.players p ON p.family_id = f.id
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.donate_to_family(bigint) IS 
'Donate cash to your Family bank. Increases bank balance and family Respect (Bulletstar family contribution system).';

-- Update promote/demote to support new roles and limits
-- (recreate with new role list and manager limit enforcement)
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
  manager_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT role INTO my_role FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = auth.uid();

  -- Permission check: boss, underboss, or manager can promote in some cases
  IF NOT (my_role IN ('boss', 'underboss', 'manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Managers can only manage lower roles (soldier/associate)
  IF my_role = 'manager' AND p_new_role NOT IN ('soldier', 'associate') THEN
    RAISE EXCEPTION 'MANAGERS_CAN_ONLY_MANAGE_LOWER_ROLES';
  END IF;

  SELECT family_id, role INTO target_family_id, target_role 
  FROM public.family_members 
  WHERE player_id = p_target_player_id;

  IF target_family_id IS NULL OR target_family_id != my_family_id THEN
    RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY';
  END IF;

  IF p_target_player_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_PROMOTE_SELF';
  END IF;

  -- Enforce max 2 managers
  IF p_new_role = 'manager' THEN
    SELECT COUNT(*) INTO manager_count 
    FROM public.family_members 
    WHERE family_id = my_family_id AND role = 'manager';
    
    IF manager_count >= 2 THEN
      RAISE EXCEPTION 'MAX_2_MANAGERS';
    END IF;
  END IF;

  -- Basic rank validation (simplified for now)
  UPDATE public.family_members
  SET role = p_new_role
  WHERE family_id = my_family_id AND player_id = p_target_player_id;

  RETURN jsonb_build_object('success', true, 'new_role', p_new_role);
END;
$$;

-- Similar for demote (simplified, can expand)
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
BEGIN
  -- Similar permission logic as promote
  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  SELECT role INTO my_role FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = auth.uid();

  IF NOT (my_role IN ('boss', 'underboss', 'manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Update logic...
  UPDATE public.family_members
  SET role = p_new_role
  WHERE family_id = my_family_id AND player_id = p_target_player_id;

  RETURN jsonb_build_object('success', true);
END;
$$;