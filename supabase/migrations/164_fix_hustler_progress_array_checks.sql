-- 164_fix_hustler_progress_array_checks.sql
-- Fix JSONB array containment checks in record_hustler_progress.
-- daily_claimed / weekly_claimed are JSONB arrays, so the `?` key-exists
-- operator was always returning false/failing silently. Use the proper
-- JSONB array-contains operator `@>` instead.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_hustler_progress(p_type text, p_amount int default 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uname text;
  hp public.hustler_progress;
  dt jsonb := '[]'::jsonb;
  wt jsonb := '[]'::jsonb;
  el jsonb; new_el jsonb; i int;
  fam_id uuid;
BEGIN
  SELECT username INTO v_uname FROM public.players WHERE id = auth.uid();
  IF v_uname IS NULL THEN RETURN; END IF;
  SELECT * INTO hp FROM public.hustler_progress WHERE username = v_uname FOR UPDATE;
  IF hp.username IS NULL THEN
    INSERT INTO public.hustler_progress (username) VALUES (v_uname);
    SELECT * INTO hp FROM public.hustler_progress WHERE username = v_uname FOR UPDATE;
  END IF;

  -- DAILY
  FOR i IN 0..jsonb_array_length(hp.daily_tasks)-1 LOOP
    el := hp.daily_tasks->i;
    IF el->>'type' = p_type AND NOT (hp.daily_claimed @> to_jsonb(el->>'id')) THEN
      new_el := jsonb_set(el, '{progress}', to_jsonb(least((el->>'target')::int, (el->>'progress')::int + p_amount)));
      dt := dt || jsonb_build_array(new_el);
    ELSE
      dt := dt || jsonb_build_array(el);
    END IF;
  END LOOP;
  -- WEEKLY (incl. coop types that map to a base action)
  FOR i IN 0..jsonb_array_length(hp.weekly_tasks)-1 LOOP
    el := hp.weekly_tasks->i;
    IF NOT (hp.weekly_claimed @> to_jsonb(el->>'id')) AND (
         el->>'type' = p_type
         OR (el->>'type' = 'coop_crime' AND p_type = 'crime')
         OR (el->>'type' = 'coop_heist' AND p_type = 'heist')
       ) THEN
      new_el := jsonb_set(el, '{progress}', to_jsonb(least((el->>'target')::int, (el->>'progress')::int + p_amount)));
      wt := wt || jsonb_build_array(new_el);
    ELSE
      wt := wt || jsonb_build_array(el);
    END IF;
  END LOOP;

  UPDATE public.hustler_progress SET daily_tasks = dt, weekly_tasks = wt WHERE username = v_uname;

  -- FAMILY weekly: only the matching action type, only if in a family
  SELECT family_id INTO fam_id FROM public.players WHERE id = auth.uid();
  IF fam_id IS NOT NULL AND hp.family_task IS NOT NULL AND hp.family_claimed = false
     AND hp.family_task->>'type' = p_type THEN
    UPDATE public.hustler_progress
       SET family_task = jsonb_set(family_task, '{progress}',
             to_jsonb(least((family_task->>'target')::int, (family_task->>'progress')::int + p_amount)))
     WHERE username = v_uname;
  END IF;
END;
$$;

COMMIT;
