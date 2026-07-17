-- 072_messages_dm_and_read.sql
-- =====================================================================
-- SPOOR B2 — PHONE INBOX BACKEND: player DMs + read tracking
-- ---------------------------------------------------------------------
-- The messages table (023) had SELECT (own, received) and INSERT
-- (as sender) policies but no way to mark messages read and no safe way
-- to DM by username (players is RLS owner-read, so the client can't
-- resolve a username to an id).
--   * UPDATE is now allowed ONLY on the read column of your own
--     received messages (column-level grant + policy).
--   * send_player_message(target_username, body): 500 char cap,
--     10s rate limit, resolves the target server-side.
--   * get_my_inbox(limit): both directions (sent + received) with
--     usernames resolved, for the phone-style thread UI.
-- =====================================================================

CREATE INDEX IF NOT EXISTS messages_to_time   ON public.messages (to_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_from_time ON public.messages (from_player_id, created_at DESC);

-- ---------- mark-read: only the read flag, only on your own inbox ----------
REVOKE UPDATE ON public.messages FROM public, anon, authenticated;
GRANT UPDATE (read) ON public.messages TO authenticated;

DROP POLICY IF EXISTS "Players can mark their messages read" ON public.messages;
CREATE POLICY "Players can mark their messages read" ON public.messages
  FOR UPDATE USING (auth.uid() = to_player_id) WITH CHECK (auth.uid() = to_player_id);

-- ---------- send a DM by username ----------
CREATE OR REPLACE FUNCTION public.send_player_message(target_username text, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me public.players;
  target_id uuid;
  last_sent timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'EMPTY_MESSAGE'; END IF;
  IF length(p_body) > 500 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

  SELECT * INTO me FROM public.players WHERE id = auth.uid();
  IF me.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  SELECT id INTO target_id FROM public.players WHERE username = target_username;
  IF target_id IS NULL THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target_id = me.id THEN RAISE EXCEPTION 'CANNOT_MESSAGE_SELF'; END IF;

  -- 10s rate limit across all outgoing DMs
  SELECT created_at INTO last_sent FROM public.messages
   WHERE from_player_id = me.id ORDER BY created_at DESC LIMIT 1;
  IF last_sent IS NOT NULL AND now() < last_sent + interval '10 seconds' THEN
    RAISE EXCEPTION 'MESSAGE_TOO_FAST';
  END IF;

  INSERT INTO public.messages (from_player_id, to_player_id, subject, body)
  VALUES (me.id, target_id, 'dm', btrim(p_body));

  RETURN jsonb_build_object('success', true, 'to', target_username);
END;
$$;

REVOKE ALL ON FUNCTION public.send_player_message(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_player_message(text, text) TO authenticated;

-- ---------- inbox: both directions, usernames resolved ----------
CREATE OR REPLACE FUNCTION public.get_my_inbox(p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'created_at') DESC), '[]'::jsonb) INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', msg.id,
      'from_id', msg.from_player_id,
      'to_id', msg.to_player_id,
      'from_name', pf.username,
      'to_name', pt.username,
      'subject', msg.subject,
      'body', msg.body,
      'read', msg.read,
      'mine', msg.from_player_id = auth.uid(),
      'created_at', msg.created_at
    ) AS m
    FROM public.messages msg
    LEFT JOIN public.players pf ON pf.id = msg.from_player_id
    LEFT JOIN public.players pt ON pt.id = msg.to_player_id
    WHERE msg.to_player_id = auth.uid() OR msg.from_player_id = auth.uid()
    ORDER BY msg.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  ) sub;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_inbox(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_inbox(int) TO authenticated;
