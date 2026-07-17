-- 073_most_wanted_dirty_cash.sql
-- =====================================================================
-- Most Wanted shows DIRTY cash, not clean cash (bug-inspectie list).
-- The board is a laundering-pressure ranking: criminals sitting on
-- unwashed money get advertised. The normal leaderboard keeps showing
-- clean money only.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_most_wanted(limit_count integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ranked AS (
    SELECT
      p.id, p.username, COALESCE(p.heat, 0) AS heat, p.level,
      COALESCE(p.dirty_cash, 0) AS dirty_cash,
      p.current_city, COALESCE(p.is_donator, false) AS is_donator,
      f.tag AS family_tag,
      row_number() OVER (ORDER BY COALESCE(p.heat,0) DESC, p.level DESC, p.xp DESC) AS pos
    FROM public.players p
    LEFT JOIN public.families f ON f.id = p.family_id
    WHERE p.username IS NOT NULL
  )
  SELECT jsonb_build_object(
    'top', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pos', pos, 'username', username, 'heat', heat, 'level', level,
        'dirty_cash', dirty_cash, 'city', current_city, 'is_donator', is_donator,
        'family_tag', family_tag
      ) ORDER BY pos), '[]'::jsonb)
      FROM (SELECT * FROM ranked ORDER BY pos LIMIT LEAST(limit_count, 100)) t
    ),
    'me', (
      SELECT jsonb_build_object('pos', pos, 'username', username, 'heat', heat)
      FROM ranked WHERE id = auth.uid()
    )
  );
$function$;
