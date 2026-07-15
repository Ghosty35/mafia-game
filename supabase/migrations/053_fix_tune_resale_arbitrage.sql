-- 053_fix_tune_resale_arbitrage.sql
-- =====================================================================
-- FIX — tune-arbitrage geldkraan (geintroduceerd door 050/051 car-model)
-- ---------------------------------------------------------------------
-- _car_value() telt +2000 resale-value op bij een getunede auto, maar
-- garage_tune_car() kostte slechts 1000. Dus: koop auto -> tune (+2000
-- value voor 1000) -> verkoop = +1000 winst, oneindig herhaalbaar.
--
-- Fix: tune-kost = de resale-waarde die het toevoegt (2000), zodat
-- kopen+tunen+verkopen precies break-even is (geen winst). Parts blijven
-- veilig (kost X, +X/2 resale = verlies). Basis koop/verkoop is al
-- break-even (purchase_price = base_value in de catalogus).
--
-- Geen page-wijziging nodig: de tune-knop toont geen kostenbedrag.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.garage_tune_car(p_car_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; pc public.player_cars; c_cost constant int := 2000;
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
