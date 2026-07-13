-- ============================================================
-- FIX for create_family
-- Ensures proper level + funds enforcement + clear errors
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_family(
  p_name text,
  p_tag text,
  p_description text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_family public.families;
  my_family_id uuid;
  my_cash bigint;
  my_diamonds int;
  my_level int;
  is_don boolean;
  used_diamonds boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = auth.uid() AND username IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_USERNAME';
  END IF;

  SELECT family_id, cash, diamonds, level, COALESCE(is_donator, false)
  INTO my_family_id, my_cash, my_diamonds, my_level, is_don
  FROM public.players WHERE id = auth.uid();

  IF my_family_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_FAMILY';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 3 OR length(trim(p_name)) > 32 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_NAME';
  END IF;
  IF p_tag IS NULL OR length(trim(p_tag)) < 2 OR length(trim(p_tag)) > 5 THEN
    RAISE EXCEPTION 'INVALID_FAMILY_TAG';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(name) = lower(p_name)) THEN
    RAISE EXCEPTION 'FAMILY_NAME_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.families WHERE lower(tag) = lower(p_tag)) THEN
    RAISE EXCEPTION 'FAMILY_TAG_TAKEN';
  END IF;

  -- Pricing: 2,000,000 cash OR 25 diamonds.
  IF my_cash >= 2000000 THEN
    UPDATE public.players SET cash = cash - 2000000 WHERE id = auth.uid();
  ELSIF my_diamonds >= 25 THEN
    UPDATE public.players SET diamonds = diamonds - 25 WHERE id = auth.uid();
    used_diamonds := true;
  ELSE
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS_FOR_FAMILY';
  END IF;

  -- Level requirement:
  -- Donators paying with diamonds: any level
  -- Everyone else (cash or non-donator): level >= 10
  IF my_level < 10 AND NOT (used_diamonds AND is_don) THEN
    RAISE EXCEPTION 'LEVEL_TOO_LOW_FOR_FAMILY';
  END IF;

  INSERT INTO public.families (name, tag, description, power, bank, pending_bank)
  VALUES (trim(p_name), upper(trim(p_tag)), p_description, 0, 0, 0)
  RETURNING * INTO new_family;

  INSERT INTO public.family_members (family_id, player_id, role)
  VALUES (new_family.id, auth.uid(), 'boss');

  UPDATE public.players SET family_id = new_family.id WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'family', to_jsonb(new_family),
    'used_diamonds', used_diamonds
  );
END;
$$;