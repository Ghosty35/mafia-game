-- 068_family_inbox_and_join_requests.sql
-- =====================================================================
-- Spoor C3 — Family inbox + join requests (Family Boss Agent skill).
-- ---------------------------------------------------------------------
--   * Joining a family now goes through a REQUEST the leadership
--     (boss/underboss) accepts or rejects. The old instant
--     join_family(uuid) RPC is dropped (it would bypass approval).
--     Exception: a family with ZERO members is abandoned — requesting
--     to join it revives it and makes you its boss on the spot.
--   * One pending request per player; cancellable; the outcome lands
--     in the requester's personal messages inbox.
--   * family_messages = the family's internal communication channel:
--       - audience 'all'       : broadcast, writable by manager+
--                                (rank >= 3), readable by every member
--       - audience 'higherups' : writable by ANY member (talk to the
--                                leadership), readable by manager+ and
--                                by the sender themself
--     10s per-player rate limit, 500 char cap, last 200 kept per family.
--   * get_family_inbox() also returns pending join requests when the
--     caller is boss/underboss, so the inbox is the leadership's
--     one-stop overview.
-- =====================================================================

-- ---------- A) tables ----------

CREATE TABLE IF NOT EXISTS public.family_join_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  player_id            uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  username             text NOT NULL,
  level                int NOT NULL DEFAULT 1,
  message              text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  resolved_by_username text
);

-- one open request per player
CREATE UNIQUE INDEX IF NOT EXISTS family_join_requests_one_pending
  ON public.family_join_requests (player_id) WHERE status = 'pending';

-- RLS on, no policies: only reachable via the SECURITY DEFINER RPCs below.
ALTER TABLE public.family_join_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.family_messages (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id      uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  from_player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  from_username  text NOT NULL,
  from_role      text NOT NULL,
  audience       text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'higherups')),
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_messages_family_idx
  ON public.family_messages (family_id, id DESC);

ALTER TABLE public.family_messages ENABLE ROW LEVEL SECURITY;

-- ---------- B) join requests ----------

CREATE OR REPLACE FUNCTION public.request_join_family(p_family_id uuid, p_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me public.players;
  fam public.families;
  req_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO me FROM public.players WHERE id = auth.uid();
  IF me.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF me.username IS NULL THEN RAISE EXCEPTION 'NO_USERNAME'; END IF;
  IF me.family_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = p_family_id FOR UPDATE;
  IF fam.id IS NULL THEN RAISE EXCEPTION 'FAMILY_NOT_FOUND'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_join_requests
    WHERE player_id = me.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_PENDING';
  END IF;

  p_message := left(trim(COALESCE(p_message, '')), 200);
  IF p_message = '' THEN p_message := NULL; END IF;

  -- Abandoned family (no members): walk in and take the chair.
  IF NOT EXISTS (SELECT 1 FROM public.family_members WHERE family_id = fam.id) THEN
    INSERT INTO public.family_members (family_id, player_id, role)
    VALUES (fam.id, me.id, 'boss');
    UPDATE public.players SET family_id = fam.id WHERE id = me.id;
    PERFORM public.log_event('family', 'revived ' || fam.name || ' and became its boss!');
    RETURN jsonb_build_object('success', true, 'joined_directly', true, 'family', fam.name);
  END IF;

  INSERT INTO public.family_join_requests (family_id, player_id, username, level, message)
  VALUES (fam.id, me.id, me.username, COALESCE(me.level, 1), p_message)
  RETURNING id INTO req_id;

  RETURN jsonb_build_object('success', true, 'joined_directly', false, 'request_id', req_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_join_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.family_join_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  UPDATE public.family_join_requests
  SET status = 'cancelled', resolved_at = now()
  WHERE player_id = auth.uid() AND status = 'pending'
  RETURNING * INTO req;

  IF req.id IS NULL THEN RAISE EXCEPTION 'NO_PENDING_REQUEST'; END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- The requester's own pending request (families page shows its state).
CREATE OR REPLACE FUNCTION public.get_my_join_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT jsonb_build_object(
    'request_id', r.id,
    'family_id', r.family_id,
    'family_name', f.name,
    'created_at', r.created_at
  ) INTO result
  FROM public.family_join_requests r
  JOIN public.families f ON f.id = r.family_id
  WHERE r.player_id = auth.uid() AND r.status = 'pending';

  RETURN COALESCE(result, 'null'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_join_request(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.family_join_requests;
  my_family_id uuid;
  my_role text;
  fam public.families;
  target public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id, role INTO my_family_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF public._family_rank(my_role) < 5 THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO req FROM public.family_join_requests WHERE id = p_request_id FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF req.family_id <> my_family_id THEN RAISE EXCEPTION 'NOT_YOUR_FAMILY'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_ALREADY_RESOLVED'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = my_family_id;

  IF p_accept THEN
    SELECT * INTO target FROM public.players WHERE id = req.player_id FOR UPDATE;
    -- Requester joined another family in the meantime: auto-reject.
    IF target.id IS NULL OR target.family_id IS NOT NULL THEN
      UPDATE public.family_join_requests
      SET status = 'rejected', resolved_at = now(),
          resolved_by_username = (SELECT username FROM public.players WHERE id = auth.uid())
      WHERE id = req.id;
      RAISE EXCEPTION 'TARGET_ALREADY_IN_FAMILY';
    END IF;

    INSERT INTO public.family_members (family_id, player_id, role)
    VALUES (my_family_id, req.player_id, 'soldier');
    UPDATE public.players SET family_id = my_family_id WHERE id = req.player_id;

    UPDATE public.family_join_requests
    SET status = 'accepted', resolved_at = now(),
        resolved_by_username = (SELECT username FROM public.players WHERE id = auth.uid())
    WHERE id = req.id;

    INSERT INTO public.messages (to_player_id, from_player_id, subject, body)
    VALUES (req.player_id, auth.uid(),
            'Welcome to ' || fam.name,
            'Your request to join ' || fam.name || ' was accepted. Welcome to the family, soldier.');

    PERFORM public._log_event_named(req.username, 'family', 'joined ' || fam.name || '!');

    RETURN jsonb_build_object('success', true, 'accepted', true, 'username', req.username);
  ELSE
    UPDATE public.family_join_requests
    SET status = 'rejected', resolved_at = now(),
        resolved_by_username = (SELECT username FROM public.players WHERE id = auth.uid())
    WHERE id = req.id;

    INSERT INTO public.messages (to_player_id, from_player_id, subject, body)
    VALUES (req.player_id, auth.uid(),
            'Request rejected',
            'Your request to join ' || fam.name || ' was rejected.');

    RETURN jsonb_build_object('success', true, 'accepted', false, 'username', req.username);
  END IF;
END;
$$;

-- ---------- C) family inbox ----------

CREATE OR REPLACE FUNCTION public.send_family_message(p_body text, p_audience text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  my_username text;
  last_sent timestamptz;
  msg_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_audience NOT IN ('all', 'higherups') THEN RAISE EXCEPTION 'INVALID_AUDIENCE'; END IF;

  p_body := trim(COALESCE(p_body, ''));
  IF p_body = '' THEN RAISE EXCEPTION 'EMPTY_MESSAGE'; END IF;
  IF length(p_body) > 500 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

  SELECT family_id, role INTO my_family_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  -- broadcast to everyone is a management tool (manager and up)
  IF p_audience = 'all' AND public._family_rank(my_role) < 3 THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT max(created_at) INTO last_sent
  FROM public.family_messages
  WHERE family_id = my_family_id AND from_player_id = auth.uid();
  IF last_sent IS NOT NULL AND now() < last_sent + interval '10 seconds' THEN
    RAISE EXCEPTION 'MESSAGE_TOO_FAST';
  END IF;

  SELECT username INTO my_username FROM public.players WHERE id = auth.uid();

  INSERT INTO public.family_messages (family_id, from_player_id, from_username, from_role, audience, body)
  VALUES (my_family_id, auth.uid(), COALESCE(my_username, '?'), my_role, p_audience, p_body)
  RETURNING id INTO msg_id;

  -- retention: keep the last 200 messages per family
  IF random() < 0.05 THEN
    DELETE FROM public.family_messages
    WHERE family_id = my_family_id
      AND id NOT IN (
        SELECT id FROM public.family_messages
        WHERE family_id = my_family_id
        ORDER BY id DESC LIMIT 200
      );
  END IF;

  RETURN jsonb_build_object('success', true, 'message_id', msg_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_inbox(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  my_rank int;
  msgs jsonb;
  reqs jsonb := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  SELECT family_id, role INTO my_family_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  my_rank := public._family_rank(my_role);

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY (m.id)), '[]'::jsonb) INTO msgs
  FROM (
    SELECT id, from_username, from_role, audience, body, created_at,
           (from_player_id = auth.uid()) AS mine
    FROM public.family_messages
    WHERE family_id = my_family_id
      AND (audience = 'all' OR my_rank >= 3 OR from_player_id = auth.uid())
    ORDER BY id DESC
    LIMIT p_limit
  ) m;

  -- leadership overview: pending join requests ride along for boss/underboss
  IF my_rank >= 5 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY (r.created_at)), '[]'::jsonb) INTO reqs
    FROM (
      SELECT id, username, level, message, created_at
      FROM public.family_join_requests
      WHERE family_id = my_family_id AND status = 'pending'
    ) r;
  END IF;

  RETURN jsonb_build_object(
    'my_role', my_role,
    'can_broadcast', my_rank >= 3,
    'is_higherup', my_rank >= 3,
    'can_manage_requests', my_rank >= 5,
    'messages', msgs,
    'join_requests', reqs
  );
END;
$$;

-- ---------- D) drop the instant-join backdoor ----------

DROP FUNCTION IF EXISTS public.join_family(uuid);

-- ---------- E) grants ----------

REVOKE ALL ON FUNCTION public.request_join_family(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_join_family(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_join_request() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_join_request() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_join_request() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_join_request() TO authenticated;
REVOKE ALL ON FUNCTION public.respond_join_request(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_join_request(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.send_family_message(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_family_message(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_family_inbox(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_family_inbox(int) TO authenticated;
