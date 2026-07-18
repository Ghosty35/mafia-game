-- 123_forum_system.sql
-- General forum for the game with categories:
-- general, recruitment, announcements

-- ============================================================
-- 1) Forum categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.forum_categories (id, name, description, sort_order) VALUES
  ('general', 'General Discussion', 'Talk about anything related to the game.', 1),
  ('recruitment', 'Family Recruitment', 'Recruit players for your family or find a family to join.', 2),
  ('announcements', 'Announcements', 'Important game updates and news from the admin.', 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2) Forum posts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id text NOT NULL REFERENCES public.forum_categories(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forum_posts_read ON public.forum_posts;
CREATE POLICY forum_posts_read ON public.forum_posts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS forum_posts_insert ON public.forum_posts;
CREATE POLICY forum_posts_insert ON public.forum_posts
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    auth.uid() = author_id AND
    NOT public.is_banned(auth.uid()) AND
    NOT public.is_timed_out(auth.uid())
  );

DROP POLICY IF EXISTS forum_posts_update ON public.forum_posts;
CREATE POLICY forum_posts_update ON public.forum_posts
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND
    (auth.uid() = author_id OR public.is_admin())
  );

DROP POLICY IF EXISTS forum_posts_delete ON public.forum_posts;
CREATE POLICY forum_posts_delete ON public.forum_posts
  FOR DELETE USING (
    auth.uid() IS NOT NULL AND
    (auth.uid() = author_id OR public.is_admin())
  );

-- ============================================================
-- 3) Forum replies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forum_replies_read ON public.forum_replies;
CREATE POLICY forum_replies_read ON public.forum_replies
  FOR SELECT USING (true);

DROP POLICY IF EXISTS forum_replies_insert ON public.forum_replies;
CREATE POLICY forum_replies_insert ON public.forum_replies
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    auth.uid() = author_id AND
    NOT public.is_banned(auth.uid()) AND
    NOT public.is_timed_out(auth.uid()) AND
    EXISTS (
      SELECT 1 FROM public.forum_posts fp
      WHERE fp.id = post_id AND fp.is_locked = false
    )
  );

DROP POLICY IF EXISTS forum_replies_update ON public.forum_replies;
CREATE POLICY forum_replies_update ON public.forum_replies
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND
    (auth.uid() = author_id OR public.is_admin())
  );

DROP POLICY IF EXISTS forum_replies_delete ON public.forum_replies;
CREATE POLICY forum_replies_delete ON public.forum_replies
  FOR DELETE USING (
    auth.uid() IS NOT NULL AND
    (auth.uid() = author_id OR public.is_admin())
  );

-- ============================================================
-- 4) Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_forum_posts_category ON public.forum_posts(category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON public.forum_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_post ON public.forum_replies(post_id, created_at ASC);

-- ============================================================
-- 5) RPCs
-- ============================================================

-- List categories
CREATE OR REPLACE FUNCTION public.list_forum_categories()
RETURNS SETOF public.forum_categories
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT * FROM public.forum_categories ORDER BY sort_order;
$$;

-- List posts (optionally filtered by category)
CREATE OR REPLACE FUNCTION public.list_forum_posts(p_category_id text DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', fp.id,
    'category_id', fp.category_id,
    'author_id', fp.author_id,
    'author_name', COALESCE(p.username, 'Unknown'),
    'title', fp.title,
    'content', fp.content,
    'is_pinned', fp.is_pinned,
    'is_locked', fp.is_locked,
    'created_at', fp.created_at,
    'updated_at', fp.updated_at,
    'reply_count', COALESCE((
      SELECT COUNT(*) FROM public.forum_replies fr WHERE fr.post_id = fp.id
    ), 0),
    'last_reply_at', COALESCE((
      SELECT MAX(fr.created_at) FROM public.forum_replies fr WHERE fr.post_id = fp.id
    ), fp.created_at)
  )
  FROM public.forum_posts fp
  LEFT JOIN public.players p ON p.id = fp.author_id
  WHERE p_category_id IS NULL OR fp.category_id = p_category_id
  ORDER BY fp.is_pinned DESC, COALESCE((
    SELECT MAX(fr.created_at) FROM public.forum_replies fr WHERE fr.post_id = fp.id
  ), fp.created_at) DESC
  LIMIT 50;
END;
$$;

-- Get single post with replies
CREATE OR REPLACE FUNCTION public.get_forum_post(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  post jsonb;
  replies jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', fp.id,
    'category_id', fp.category_id,
    'author_id', fp.author_id,
    'author_name', COALESCE(p.username, 'Unknown'),
    'title', fp.title,
    'content', fp.content,
    'is_pinned', fp.is_pinned,
    'is_locked', fp.is_locked,
    'created_at', fp.created_at,
    'updated_at', fp.updated_at
  ) INTO post
  FROM public.forum_posts fp
  LEFT JOIN public.players p ON p.id = fp.author_id
  WHERE fp.id = p_post_id;

  IF post IS NULL THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', fr.id,
      'author_id', fr.author_id,
      'author_name', COALESCE(rp.username, 'Unknown'),
      'content', fr.content,
      'created_at', fr.created_at,
      'updated_at', fr.updated_at
    ) ORDER BY fr.created_at ASC
  ), '[]'::jsonb) INTO replies
  FROM public.forum_replies fr
  LEFT JOIN public.players rp ON rp.id = fr.author_id
  WHERE fr.post_id = p_post_id;

  post := jsonb_set(post, '{replies}', replies);
  RETURN post;
END;
$$;

-- Create post
CREATE OR REPLACE FUNCTION public.create_forum_post(p_category_id text, p_title text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_post public.forum_posts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF public.is_banned(auth.uid()) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(auth.uid()) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;
  IF length(btrim(p_title)) < 3 THEN RAISE EXCEPTION 'TITLE_TOO_SHORT'; END IF;
  IF length(btrim(p_content)) < 1 THEN RAISE EXCEPTION 'CONTENT_TOO_SHORT'; END IF;

  INSERT INTO public.forum_posts (category_id, author_id, title, content)
  VALUES (p_category_id, auth.uid(), btrim(p_title), btrim(p_content))
  RETURNING * INTO v_post;

  RETURN jsonb_build_object(
    'id', v_post.id,
    'category_id', v_post.category_id,
    'author_id', v_post.author_id,
    'title', v_post.title,
    'content', v_post.content,
    'created_at', v_post.created_at
  );
END;
$$;

-- Create reply
CREATE OR REPLACE FUNCTION public.create_forum_reply(p_post_id uuid, p_content text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_reply public.forum_replies;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF public.is_banned(auth.uid()) THEN RAISE EXCEPTION 'BANNED'; END IF;
  IF public.is_timed_out(auth.uid()) THEN RAISE EXCEPTION 'TIMED_OUT'; END IF;
  IF length(btrim(p_content)) < 1 THEN RAISE EXCEPTION 'CONTENT_TOO_SHORT'; END IF;

  INSERT INTO public.forum_replies (post_id, author_id, content)
  VALUES (p_post_id, auth.uid(), btrim(p_content))
  RETURNING * INTO v_reply;

  RETURN jsonb_build_object(
    'id', v_reply.id,
    'post_id', v_reply.post_id,
    'author_id', v_reply.author_id,
    'content', v_reply.content,
    'created_at', v_reply.created_at
  );
END;
$$;

-- Admin: pin/unpin post
CREATE OR REPLACE FUNCTION public.admin_pin_forum_post(p_post_id uuid, p_pinned boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE public.forum_posts SET is_pinned = p_pinned WHERE id = p_post_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Admin: lock/unlock post
CREATE OR REPLACE FUNCTION public.admin_lock_forum_post(p_post_id uuid, p_locked boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE public.forum_posts SET is_locked = p_locked WHERE id = p_post_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 6) Players without family (for family submenu)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_players_without_family()
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'level', p.level,
    'power', p.power,
    'created_at', p.created_at,
    'last_active', p.last_active,
    'is_online', p.last_active > now() - interval '1 hour'
  )
  FROM public.players p
  WHERE p.family_id IS NULL
    AND p.created_at < now() - interval '2 weeks'
    AND p.last_active > now() - interval '7 days'
  ORDER BY p.last_active DESC NULLS LAST
  LIMIT 50;
END;
$$;

-- ============================================================
-- 7) Grants
-- ============================================================
GRANT ALL ON TABLE public.forum_categories TO authenticated;
GRANT ALL ON TABLE public.forum_posts TO authenticated;
GRANT ALL ON TABLE public.forum_replies TO authenticated;

GRANT EXECUTE ON FUNCTION public.list_forum_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_forum_posts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_forum_post(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_forum_reply(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pin_forum_post(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lock_forum_post(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_players_without_family() TO authenticated;
