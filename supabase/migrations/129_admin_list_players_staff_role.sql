-- 129_admin_list_players_staff_role.sql
-- Add staff_role to admin_list_players output.

CREATE OR REPLACE FUNCTION public.admin_list_players(search text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', id, 'username', username, 'cash', cash, 'power', power,
    'level', level, 'rebirths', rebirths, 'murder_skill', murder_skill,
    'is_donator', is_donator, 'jailed_until', jailed_until,
    'death_until', death_until, 'heat', heat, 'personal_bank', personal_bank,
    'warnings', COALESCE(pm.warnings, 0),
    'banned_until', pm.banned_until,
    'banned_permanent', COALESCE(pm.banned_permanent, false),
    'timeout_until', pm.timeout_until,
    'ip_banned', COALESCE(pm.ip_banned, false),
    'staff_role', p.staff_role
  )
  FROM public.players p
  LEFT JOIN public.player_moderation pm ON pm.player_id = p.id
  WHERE search IS NULL OR username ILIKE '%' || search || '%'
  ORDER BY cash DESC
  LIMIT 50;
END;
$$;
