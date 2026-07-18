-- 133_role_based_admin_no_hardcode.sql
-- CEO = full/dev perks; general staff = is_admin(). Remove the YGhosty username hardcode.

CREATE OR REPLACE FUNCTION public.is_ceo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT staff_role = 'ceo' FROM public.players WHERE id = auth.uid()), false);
$$;

-- Replace the hardcoded username='YGhosty' moderation policy with role-based is_admin().
DROP POLICY IF EXISTS player_moderation_admin ON public.player_moderation;
CREATE POLICY player_moderation_admin ON public.player_moderation
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
