-- 130_reserve_yghosty_and_transfer_business_properties.sql
-- Reserve "YGhosty" username and transfer all business properties to CEO.

-- ============================================================
-- 1) Reserve "YGhosty" in set_username RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_username(new_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF new_username !~ '^[A-Za-z0-9_]{3,16}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME';
  END IF;

  IF lower(new_username) = 'yghosty' THEN
    RAISE EXCEPTION 'USERNAME_RESERVED';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.username IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_SET'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.players WHERE lower(username) = lower(new_username)
  ) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE public.players
  SET username = new_username
  WHERE id = auth.uid()
  RETURNING * INTO p;

  RETURN to_jsonb(p);
END;
$$;

-- ============================================================
-- 2) Reserve "YGhosty" in handle_new_user trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  wanted text;
BEGIN
  wanted := new.raw_user_meta_data ->> 'username';

  IF wanted IS NULL
     OR wanted !~ '^[A-Za-z0-9_]{3,16}$'
     OR lower(wanted) = 'yghosty'
     OR EXISTS (SELECT 1 FROM public.players WHERE lower(username) = lower(wanted))
  THEN
    wanted := NULL;
  END IF;

  INSERT INTO public.players (id, username) VALUES (new.id, wanted);
  RETURN new;
END;
$$;

-- ============================================================
-- 3) Transfer all business properties to YGhosty
-- ============================================================
UPDATE public.properties
SET owner_id = (SELECT id FROM public.players WHERE username = 'YGhosty')
WHERE type IN (
  'detective_agency', 'general_bank', 'hospital',
  'train_station', 'metal_factory', 'business'
);

-- ============================================================
-- 4) Ensure YGhosty has these properties in owned_properties
-- ============================================================
DO $$
DECLARE
  yghosty_id uuid;
  prop record;
  owned jsonb;
BEGIN
  SELECT id INTO yghosty_id FROM public.players WHERE username = 'YGhosty';
  IF yghosty_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(owned_properties, '[]'::jsonb) INTO owned
  FROM public.players WHERE id = yghosty_id;

  FOR prop IN
    SELECT id, name, city, type, income_per_hour
    FROM public.properties
    WHERE owner_id = yghosty_id
      AND type IN ('detective_agency', 'general_bank', 'hospital',
                   'train_station', 'metal_factory', 'business')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(owned) elem
      WHERE elem->>'id' = prop.id::text
    ) THEN
      owned := owned || jsonb_build_object(
        'id', prop.id,
        'name', prop.name,
        'city', prop.city,
        'type', prop.type,
        'income_per_hour', prop.income_per_hour,
        'purchased_at', to_char(now(), 'YYYY-MM-DD HH24:MI')
      );
    END IF;
  END LOOP;

  UPDATE public.players
  SET owned_properties = owned
  WHERE id = yghosty_id;
END;
$$;
