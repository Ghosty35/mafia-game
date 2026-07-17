-- 059_residuals_bank_balance_and_car_cap.sql
-- =====================================================================
-- CLEANUP — low-residual exploits opruimen
-- ---------------------------------------------------------------------
-- 1) Legacy owned_properties dragen een geforgede bank_balance mee uit de
--    oude client-faucet (simulateEarnings). Server-side income accrueerde
--    nooit (036 tick was dood), dus ELKE bestaande bank_balance is forged.
--    We nullen ze; echte income accrueert voortaan via collect_property_income.
--
-- 2) garage_buy_car had geen server-side max-auto's-cap. We leiden de cap af
--    uit properties (house/villa/mansion) + garage_level, zoals de UI.
-- =====================================================================

-- ---------- 1) forged bank_balance nullen ----------
UPDATE public.players p
SET owned_properties = (
  SELECT jsonb_agg(jsonb_set(e, '{bank_balance}', to_jsonb(0)))
  FROM jsonb_array_elements(p.owned_properties) e
)
WHERE jsonb_typeof(p.owned_properties) = 'array'
  AND jsonb_array_length(p.owned_properties) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.owned_properties) e
    WHERE COALESCE((e->>'bank_balance')::bigint, 0) <> 0
  );

-- ---------- 2) garage_buy_car met server-side cap ----------
CREATE OR REPLACE FUNCTION public.garage_buy_car(p_catalog_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players; cc public.car_catalog; new_id uuid;
  max_cars int; cur_cars int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO cc FROM public.car_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_CAR'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  -- max auto's uit properties + garage_level (bron: garage/page.tsx)
  max_cars := CASE
    WHEN public._count_owned_ptype(p.owned_properties, 'mansion') > 0 THEN 8 + COALESCE(p.garage_level,0) * 10
    WHEN public._count_owned_ptype(p.owned_properties, 'villa')   > 0 THEN 4 + COALESCE(p.garage_level,0) * 4
    WHEN public._count_owned_ptype(p.owned_properties, 'house')   > 0 THEN 2
    ELSE 0
  END;
  SELECT count(*) INTO cur_cars FROM public.player_cars WHERE player_id = p.id;
  IF cur_cars >= max_cars THEN RAISE EXCEPTION 'GARAGE_FULL'; END IF;

  IF p.cash < cc.purchase_price THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players SET cash = cash - cc.purchase_price WHERE id = p.id;
  INSERT INTO public.player_cars (player_id, catalog_id, model, base_value)
    VALUES (p.id, cc.id, cc.name, cc.base_value) RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'car_id', new_id, 'new_cash', p.cash - cc.purchase_price);
END;
$$;
