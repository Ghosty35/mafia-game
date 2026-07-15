-- 049_train_breakout_rpc.sql
-- =====================================================================
-- SPOOR A4 (deel 2) — server-authoritative breakout-training
-- ---------------------------------------------------------------------
-- Voorheen: jail-pagina berekende kosten (500) en nieuwe skill (+5) in de
-- browser en schreef breakout_skill via apply_action -> client kon skill
-- direct op 100 zetten of gratis trainen.
--
-- Nu: dedicated train_breakout() RPC dwingt kosten + increment server-side
-- af. breakout_skill wordt verwijderd uit apply_action zodat de generieke
-- patch-RPC hem niet meer kan schrijven.
--
-- Constants (bron: oude jail/page.tsx): kosten 500, +5 per sessie, cap 100.
-- =====================================================================

-- ---------- server-authoritative training ----------
CREATE OR REPLACE FUNCTION public.train_breakout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_cost      constant bigint  := 500;
  c_increment constant numeric := 5;
  c_cap       constant numeric := 100;
  p           public.players;
  new_skill   numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF p.cash < c_cost THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  new_skill := LEAST(c_cap, COALESCE(p.breakout_skill, 0) + c_increment);

  UPDATE public.players
     SET cash           = cash - c_cost,
         breakout_skill = new_skill
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'success',        true,
    'breakout_skill', new_skill,
    'new_cash',       p.cash - c_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.train_breakout() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.train_breakout() TO authenticated;

-- ---------- apply_action zonder breakout_skill ----------
CREATE OR REPLACE FUNCTION public.apply_action(cash_delta bigint, patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cash_delta < -10000000 OR cash_delta > 10000000 THEN
    RAISE EXCEPTION 'CASH_DELTA_OUT_OF_BOUNDS';
  END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;

  IF cash_delta < 0 AND p.cash + cash_delta < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  UPDATE public.players SET
    cash             = cash + cash_delta,
    owned_properties = CASE WHEN patch ? 'owned_properties' THEN patch->'owned_properties' ELSE owned_properties END,
    cars             = CASE WHEN patch ? 'cars' THEN patch->'cars' ELSE cars END,
    garage_level     = CASE WHEN patch ? 'garage_level' THEN (patch->>'garage_level')::int ELSE garage_level END,
    heat             = CASE WHEN patch ? 'heat' THEN LEAST(100, GREATEST(0, (patch->>'heat')::int)) ELSE heat END,
    bullets          = CASE WHEN patch ? 'bullets' THEN GREATEST(0, (patch->>'bullets')::bigint) ELSE bullets END,
    heist_gear       = CASE WHEN patch ? 'heist_gear' THEN patch->'heist_gear' ELSE heist_gear END
    -- verwijderd (server-owned): breakout_skill (zie train_breakout),
    --   drug_storage, weed_plants, weed_progress, harvest_kg (048)
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'new_cash', p.cash + cash_delta);
END;
$$;
