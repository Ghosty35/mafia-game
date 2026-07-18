-- 091_property_expansion.sql
-- =====================================================================
-- SPOOR A5 (deel 3) — property catalog uitbreiding + sell_property
-- =====================================================================
-- Nieuwe bezittingen ontbreken nog in de catalogus. Deze migratie voegt
-- ze toe en maakt een sell_property RPC voor vrijwillige verkoop (50%
-- terugkrijg van catalogusprijs).
-- =====================================================================

INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots) VALUES
  ('airport_ny',   'Airport',         'airport',   'agency',      'New York',    3000000,  800, 0),
  ('roulette_lv',  'Roulette',        'casino',    'agency',      'Las Vegas',   2500000,  600, 0),
  ('blackjack_lv', 'Blackjack',       'casino',    'agency',      'Las Vegas',   2000000,  500, 0),
  ('numbers_lv',   'Numbers Game',    'casino',    'agency',      'Las Vegas',    800000,  250, 0),
  ('fruit_lv',     'Fruit Machine',   'casino',    'agency',      'Las Vegas',    600000,  200, 0),
  ('tuneshop_la',  'Tuneshop',        'tuneshop',  'agency',      'Los Angeles',  700000,  280, 0),
  ('rld_lv',       'Red Light Dist.', 'redlight',  'agency',      'Las Vegas',   1500000,  700, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sell_property(p_prop_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p           public.players;
  new_props   jsonb := '[]'::jsonb;
  el          jsonb;
  found       boolean := false;
  refund      bigint := 0;
  cat_price   bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) LOOP
    IF el->>'id' = p_prop_id THEN
      SELECT COALESCE(pc.price, (el->>'price')::bigint, 0) INTO cat_price
        FROM public.property_catalog pc
       WHERE pc.id = COALESCE(el->>'catalog_id', el->>'id');
      refund := floor(cat_price * 0.50)::bigint;
      found := true;
    ELSE
      new_props := new_props || jsonb_build_array(el);
    END IF;
  END LOOP;

  IF NOT found THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;
  IF refund <= 0 THEN RAISE EXCEPTION 'CANNOT_SELL'; END IF;

  UPDATE public.players
  SET cash = cash + refund, owned_properties = new_props
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'refund', refund);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_property(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sell_property(text) TO authenticated;
