-- 051_garage_mutation_rpcs.sql
-- =====================================================================
-- SPOOR A4 (deel 3b) — server-authoritative garage-mutaties
-- ---------------------------------------------------------------------
-- Dedicated RPC's die ELKE kost + mutatie server-side afdwingen op de
-- genormaliseerde player_cars/car_catalog tabellen (050). De garage-pagina
-- gaat deze aanroepen i.p.v. cash/cars in de browser te berekenen en via
-- apply_action te schrijven.
--
-- Bronformules (oude garage/page.tsx):
--   warehouse upgrade : kost 10000*(garage_level+1), vereist Villa/Mansion
--   repair            : kost (100-condition)*50 -> condition 100
--   tune              : kost 1000, vereist condition 100 -> tuned=true (+2000 value)
--   part              : kost per part, speed_bonus += bonus, value += kost/2
--   sell              : cash += value*condition/100, verwijder auto
--   crush             : verwijder auto, bullets += 15
--   buy               : kost purchase_price uit catalogus -> nieuwe auto
--
-- Alle RPC's: auth-check, ownership-check, FOR UPDATE lock, cash-check.
-- =====================================================================

-- ---------- helper: afgeleide value van een auto-rij ----------
CREATE OR REPLACE FUNCTION public._car_value(pc public.player_cars)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pc.base_value + CASE WHEN pc.tuned THEN 2000 ELSE 0 END + pc.parts_value_bonus;
$$;

-- ---------- read: catalogus (marketplace) ----------
CREATE OR REPLACE FUNCTION public.get_car_catalog()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'tier', tier,
    'base_value', base_value, 'base_speed', base_speed, 'purchase_price', purchase_price
  ) ORDER BY purchase_price), '[]'::jsonb)
  INTO result FROM public.car_catalog;
  RETURN result;
END;
$$;

-- ---------- buy ----------
CREATE OR REPLACE FUNCTION public.garage_buy_car(p_catalog_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cc public.car_catalog; new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO cc FROM public.car_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_CAR'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cc.purchase_price THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cc.purchase_price WHERE id = p.id;
  INSERT INTO public.player_cars (player_id, catalog_id, model, base_value)
    VALUES (p.id, cc.id, cc.name, cc.base_value)
    RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'car_id', new_id, 'new_cash', p.cash - cc.purchase_price);
END;
$$;

-- ---------- repair ----------
CREATE OR REPLACE FUNCTION public.garage_repair_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; cost int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  cost := (100 - pc.condition) * 50;
  IF cost <= 0 THEN RETURN jsonb_build_object('success', true, 'noop', true); END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_cars SET condition = 100 WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- ---------- tune ----------
CREATE OR REPLACE FUNCTION public.garage_tune_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; c_cost constant int := 1000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;
  IF pc.condition < 100 THEN RAISE EXCEPTION 'TUNE_NEEDS_REPAIR'; END IF;
  IF pc.tuned THEN RAISE EXCEPTION 'ALREADY_TUNED'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < c_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - c_cost WHERE id = p.id;
  UPDATE public.player_cars SET tuned = true WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'cost', c_cost, 'new_cash', p.cash - c_cost);
END;
$$;

-- ---------- buy part ----------
CREATE OR REPLACE FUNCTION public.garage_buy_part(p_car_id uuid, p_part_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players; pc public.player_cars;
  cost int; bonus int; mod_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- server-side parts-catalogus (bron: oude tuningParts)
  CASE p_part_id
    WHEN 'engine'  THEN cost := 2500; bonus := 5; mod_name := 'Engine Upgrade';
    WHEN 'turbo'   THEN cost := 4000; bonus := 8; mod_name := 'Turbo Kit';
    WHEN 'brakes'  THEN cost := 1500; bonus := 3; mod_name := 'Brakes & Suspension';
    WHEN 'bodykit' THEN cost := 1200; bonus := 2; mod_name := 'Bodykit';
    ELSE RAISE EXCEPTION 'UNKNOWN_PART';
  END CASE;

  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost WHERE id = p.id;
  UPDATE public.player_cars SET
    speed_bonus       = LEAST(50, speed_bonus + bonus),
    parts_value_bonus = parts_value_bonus + (cost / 2),
    mods              = mods || to_jsonb(mod_name)
  WHERE id = pc.id;

  RETURN jsonb_build_object('success', true, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- ---------- sell ----------
CREATE OR REPLACE FUNCTION public.garage_sell_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; sale int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  sale := floor(public._car_value(pc) * pc.condition / 100.0)::int;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  UPDATE public.players SET cash = cash + sale WHERE id = p.id;
  DELETE FROM public.player_cars WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'sale', sale, 'new_cash', p.cash + sale);
END;
$$;

-- ---------- crush ----------
CREATE OR REPLACE FUNCTION public.garage_crush_car(p_car_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; c_bullets constant int := 15;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO pc FROM public.player_cars WHERE id = p_car_id AND player_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAR_NOT_FOUND'; END IF;

  UPDATE public.players SET bullets = COALESCE(bullets,0) + c_bullets WHERE id = auth.uid()
    RETURNING * INTO p;
  DELETE FROM public.player_cars WHERE id = pc.id;
  RETURN jsonb_build_object('success', true, 'bullets_gained', c_bullets, 'bullets', p.bullets);
END;
$$;

-- ---------- warehouse upgrade ----------
CREATE OR REPLACE FUNCTION public.garage_upgrade_warehouse()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cost int; new_level int; has_gate boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  has_gate := EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.owned_properties)='array' THEN p.owned_properties ELSE '[]'::jsonb END
    ) e WHERE e->>'name' LIKE '%Villa%' OR e->>'name' LIKE '%Mansion%'
  );
  IF NOT has_gate THEN RAISE EXCEPTION 'NEED_VILLA_OR_MANSION'; END IF;

  new_level := COALESCE(p.garage_level,0) + 1;
  cost := 10000 * new_level;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cost, garage_level = new_level WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'garage_level', new_level, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

-- ---------- grants: authenticated-only ----------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_car_catalog()',
    'public.garage_buy_car(text)',
    'public.garage_repair_car(uuid)',
    'public.garage_tune_car(uuid)',
    'public.garage_buy_part(uuid,text)',
    'public.garage_sell_car(uuid)',
    'public.garage_crush_car(uuid)',
    'public.garage_upgrade_warehouse()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated;', fn);
  END LOOP;
END $$;
