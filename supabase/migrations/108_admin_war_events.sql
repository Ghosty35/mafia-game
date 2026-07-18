-- 108_admin_war_events.sql
-- =====================================================================
-- Spoor C3 — Admin-hosted War Events (territory war with an apply flow).
-- ---------------------------------------------------------------------
-- Extends the existing family_wars table instead of adding a second
-- table, to keep resolution/income/score machinery unchanged.
--
--   * family_wars.state gains a 'pending_apply' value. While pending,
--     the event is open for families to APPLY. Once two distinct
--     families have applied, the event auto-starts (state='active',
--     24h duration) using the two applicants as attacker/defender.
--   * If the apply window lapses with fewer than two applicants, the
--     event is marked 'cancelled'.
--   * admin_open_war_event(p_city)     — admin only, 24h apply window.
--   * apply_to_war_event(p_war_id)     — boss/underboss of any family.
--   * get_war_events()                 — pending + active events for UI.
--   * cancel_war_event(p_war_id)       — admin can cancel a pending event.
--
-- All existing columns/score/loot logic is untouched; a started
-- admin event resolves exactly like a declare_war event.
-- =====================================================================

-- ---------- A) schema changes on family_wars ----------

-- Replace the state CHECK to allow the new statuses. We keep the old
-- values plus pending_apply / cancelled.
ALTER TABLE public.family_wars
  DROP CONSTRAINT IF EXISTS family_wars_state_check;

ALTER TABLE public.family_wars
  ADD CONSTRAINT family_wars_state_check
  CHECK (state IN ('active', 'attacker_won', 'defender_won', 'pending_apply', 'cancelled'));

ALTER TABLE public.family_wars
  ADD COLUMN IF NOT EXISTS applicant_1 uuid REFERENCES public.families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applicant_2 uuid REFERENCES public.families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS apply_ends_at timestamptz;

-- A pending war event has no attacker/defender yet (they are chosen from
-- the two applicants when the event starts), so these columns must be
-- nullable. They were NOT NULL from migration 067; relax them.
ALTER TABLE public.family_wars ALTER COLUMN attacker_family_id DROP NOT NULL;
ALTER TABLE public.family_wars ALTER COLUMN defender_family_id DROP NOT NULL;
ALTER TABLE public.family_wars ALTER COLUMN attacker_name DROP NOT NULL;
ALTER TABLE public.family_wars ALTER COLUMN defender_name DROP NOT NULL;
-- ends_at is only meaningful once a war is active; a pending event has none yet.
ALTER TABLE public.family_wars ALTER COLUMN ends_at DROP NOT NULL;

-- one pending-or-active event per city (covers both declare_war and admin events)
DROP INDEX IF EXISTS family_wars_one_active_per_city;
CREATE UNIQUE INDEX IF NOT EXISTS family_wars_one_active_per_city
  ON public.family_wars (city) WHERE state IN ('active', 'pending_apply');

-- ---------- B) admin opens a war event ----------

CREATE OR REPLACE FUNCTION public.admin_open_war_event(p_city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t public.territories;
  w_id uuid;
  apply_ends timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT * INTO t FROM public.territories WHERE city = p_city;
  IF t.city IS NULL THEN RAISE EXCEPTION 'CITY_NOT_FOUND'; END IF;

  -- a city can only host one live event (active or pending)
  IF EXISTS (
    SELECT 1 FROM public.family_wars
    WHERE city = p_city AND state IN ('active', 'pending_apply')
  ) THEN
    RAISE EXCEPTION 'EVENT_ALREADY_OPEN';
  END IF;

  apply_ends := now() + interval '24 hours';
  INSERT INTO public.family_wars
    (city, attacker_family_id, defender_family_id, attacker_name, defender_name,
     state, apply_ends_at)
  VALUES
    (p_city, NULL, NULL, NULL, NULL, 'pending_apply', apply_ends)
  RETURNING id INTO w_id;

  PERFORM public._log_event_named('Admin', 'war', 'opened a war event over ' || p_city || '! Families may now apply.');

  RETURN jsonb_build_object('success', true, 'war_id', w_id, 'apply_ends_at', apply_ends, 'city', p_city);
END;
$$;

-- ---------- C) a family applies to a pending event ----------

CREATE OR REPLACE FUNCTION public.apply_to_war_event(p_war_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  w public.family_wars;
  fam_id uuid;
  my_role text;
  fam public.families;
  started boolean := false;
  war_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT family_id, role INTO fam_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();

  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF my_role NOT IN ('boss', 'underboss') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'WAR_NOT_FOUND'; END IF;
  IF w.state <> 'pending_apply' THEN RAISE EXCEPTION 'EVENT_NOT_OPEN'; END IF;

  IF now() >= w.apply_ends_at THEN
    UPDATE public.family_wars SET state = 'cancelled' WHERE id = w.id;
    RAISE EXCEPTION 'EVENT_EXPIRED';
  END IF;

  IF w.applicant_1 = fam_id OR w.applicant_2 = fam_id THEN
    RAISE EXCEPTION 'ALREADY_APPLIED';
  END IF;
  IF w.applicant_1 IS NOT NULL AND w.applicant_2 IS NOT NULL THEN
    RAISE EXCEPTION 'EVENT_FULL';
  END IF;

  SELECT * INTO fam FROM public.families WHERE id = fam_id;
  IF fam.id IS NULL THEN RAISE EXCEPTION 'FAMILY_NOT_FOUND'; END IF;

  -- slot the applicant
  IF w.applicant_1 IS NULL THEN
    UPDATE public.family_wars SET applicant_1 = fam_id, attacker_name = fam.name WHERE id = w.id;
  ELSE
    UPDATE public.family_wars SET applicant_2 = fam_id, defender_name = fam.name WHERE id = w.id;
  END IF;

  -- re-read
  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id;

  -- auto-start once two families applied
  IF w.applicant_1 IS NOT NULL AND w.applicant_2 IS NOT NULL THEN
    war_ends := now() + interval '24 hours';
    UPDATE public.family_wars
    SET state = 'active',
        attacker_family_id = w.applicant_1,
        defender_family_id = w.applicant_2,
        attacker_score = 0,
        defender_score = 0,
        started_at = now(),
        ends_at = war_ends,
        apply_ends_at = NULL
    WHERE id = w.id;
    started := true;
    PERFORM public._log_event_named(
      COALESCE(w.attacker_name, 'A family') || ' vs ' || COALESCE(w.defender_name, 'a rival'), 'war',
      'the war event over ' || w.city || ' has begun — most rival kills in 24h takes the city!'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'started', started,
    'applicants', (CASE WHEN w.applicant_1 IS NOT NULL THEN 1 ELSE 0 END)
                 + (CASE WHEN w.applicant_2 IS NOT NULL THEN 1 ELSE 0 END)
  );
END;
$$;

-- ---------- D) admin cancels a pending event ----------

CREATE OR REPLACE FUNCTION public.cancel_war_event(p_war_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  w public.family_wars;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'WAR_NOT_FOUND'; END IF;
  IF w.state <> 'pending_apply' THEN RAISE EXCEPTION 'EVENT_NOT_OPEN'; END IF;

  UPDATE public.family_wars SET state = 'cancelled' WHERE id = w.id;

  PERFORM public._log_event_named('Admin', 'war', 'cancelled the war event over ' || w.city || '.');

  RETURN jsonb_build_object('success', true, 'city', w.city);
END;
$$;

-- ---------- E) reads: pending + active events ----------

CREATE OR REPLACE FUNCTION public.get_war_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_fam uuid;
  pending jsonb;
  active jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT family_id INTO my_fam FROM public.players WHERE id = auth.uid();

  -- auto-cancel pending events whose apply window lapsed
  UPDATE public.family_wars
  SET state = 'cancelled'
  WHERE state = 'pending_apply' AND now() >= apply_ends_at;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'apply_ends_at')), '[]'::jsonb) INTO pending
  FROM (
    SELECT jsonb_build_object(
      'id', fw.id,
      'city', fw.city,
      'state', fw.state,
      'applicant_1', fw.applicant_1,
      'applicant_2', fw.applicant_2,
      'applicant_1_name', fw.attacker_name,
      'applicant_2_name', fw.defender_name,
      'apply_ends_at', fw.apply_ends_at,
      'my_family_applied', (fw.applicant_1 = my_fam OR fw.applicant_2 = my_fam)
    ) AS x
    FROM public.family_wars fw
    WHERE fw.state = 'pending_apply'
  ) sub;

  -- active events already covered by get_family_wars, but expose a
  -- lightweight shape here too so one call can render both.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'ends_at')), '[]'::jsonb) INTO active
  FROM (
    SELECT jsonb_build_object(
      'id', fw.id,
      'city', fw.city,
      'attacker_name', fw.attacker_name,
      'defender_name', fw.defender_name,
      'attacker_score', fw.attacker_score,
      'defender_score', fw.defender_score,
      'ends_at', fw.ends_at,
      'my_side', CASE
        WHEN my_fam = fw.attacker_family_id THEN 'attacker'
        WHEN my_fam = fw.defender_family_id THEN 'defender'
      END
    ) AS x
    FROM public.family_wars fw
    WHERE fw.state = 'active'
  ) sub;

  RETURN jsonb_build_object('pending', pending, 'active', active, 'my_family_id', my_fam);
END;
$$;

-- ---------- F) grants ----------

REVOKE ALL ON FUNCTION public.admin_open_war_event(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_open_war_event(text) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_to_war_event(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_war_event(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_war_event(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_war_event(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_war_events() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_war_events() TO authenticated;
