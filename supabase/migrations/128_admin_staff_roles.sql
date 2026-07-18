-- 128_admin_staff_roles.sql
-- Add staff_role system: CEO, Admin, Jr-Admin, Game-Modder, Customer Support.
-- Only CEO can promote/demote staff.

-- ============================================================
-- 1) Add staff_role column and set CEO
-- ============================================================
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS staff_role text DEFAULT NULL;

UPDATE public.players SET staff_role = 'ceo' WHERE username = 'YGhosty';

-- ============================================================
-- 2) Update is_admin() to recognize CEO and Admin roles
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT staff_role IN ('ceo', 'admin', 'jr_admin', 'game_mod', 'support')
     FROM public.players WHERE id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- 3) admin_set_staff_role: CEO only
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_staff_role(
  p_target_username text,
  p_staff_role text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  t_id uuid;
  valid_roles text[] := ARRAY['ceo', 'admin', 'jr_admin', 'game_mod', 'support'];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  -- Only CEO can manage staff roles
  SELECT staff_role INTO t_id FROM public.players WHERE id = auth.uid();
  IF t_id != 'ceo' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF p_staff_role IS NOT NULL AND p_staff_role != '' AND NOT (p_staff_role = ANY(valid_roles)) THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;

  SELECT id INTO t_id FROM public.players WHERE username ILIKE p_target_username LIMIT 1;
  IF t_id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;

  UPDATE public.players
  SET staff_role = p_staff_role
  WHERE id = t_id;

  RETURN jsonb_build_object(
    'success', true,
    'username', p_target_username,
    'staff_role', p_staff_role
  );
END;
$$;

-- ============================================================
-- 4) admin_list_staff: list all staff members
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_staff()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN jsonb_build_object(
    'staff', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'username', p.username,
          'staff_role', p.staff_role,
          'level', p.level,
          'last_active', p.last_active
        )
      )
      FROM public.players p
      WHERE p.staff_role IS NOT NULL
      ORDER BY
        CASE p.staff_role
          WHEN 'ceo' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'jr_admin' THEN 3
          WHEN 'game_mod' THEN 4
          WHEN 'support' THEN 5
          ELSE 6
        END,
        p.username ASC
    )
  );
END;
$$;

-- ============================================================
-- Grants
-- ============================================================
REVOKE ALL ON FUNCTION public.admin_set_staff_role(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_staff() TO authenticated;
