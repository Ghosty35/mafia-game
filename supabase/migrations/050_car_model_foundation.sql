-- 050_car_model_foundation.sql
-- =====================================================================
-- SPOOR A4 (deel 3a) — server-authoritative auto-model: FUNDAMENT
-- ---------------------------------------------------------------------
-- Voorheen leefden auto's als vrije JSON in players.cars; de client kon
-- naam/value/condition/speed_bonus verzinnen (verkoop-value = geld-exploit,
-- speed_bonus = race-exploit).
--
-- Deze migratie legt het fundament (ADDITIEF, niets breekt):
--   * car_catalog   : canonieke modellen met vaste base_value/base_speed
--   * player_cars   : genormaliseerd eigendom, RLS owner-read, schrijven
--                     alleen via SECURITY DEFINER RPC's (geen directe DML)
--   * backfill      : bestaande players.cars JSON -> player_cars, met
--                     base_value teruggezet naar catalogus (de-forge van de
--                     verkoop-value-exploit); condition/tuned/mods behouden
--   * get_garage()  : read-RPC voor de (herschreven) garage-pagina
--
-- players.cars blijft voorlopig staan (page leest hem nog). Mutatie-RPC's
-- en het droppen van cars/garage_level/bullets uit apply_action volgen in
-- 051 + page-rewrite.
-- =====================================================================

-- ---------- canonieke modellen ----------
CREATE TABLE IF NOT EXISTS public.car_catalog (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  tier           text NOT NULL DEFAULT 'low',
  base_value     int  NOT NULL,
  base_speed     int  NOT NULL,
  purchase_price int  NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.car_catalog (id, name, tier, base_value, base_speed, purchase_price) VALUES
  ('old_sedan',   'Old Sedan',        'default', 2000,  70,  2000),
  ('sports_car',  'Sports Car',       'default', 8000,  90,  8000),
  ('honda_civic', 'Honda Civic',      'low',     3000,  85,  3000),
  ('toyota_corolla','Toyota Corolla', 'low',     3000,  85,  3000),
  ('ford_focus',  'Ford Focus',       'low',     3000,  85,  3000),
  ('vw_golf',     'VW Golf',          'low',     3000,  85,  3000),
  ('lexus_is',    'Lexus IS',         'mid',    12000, 105, 12000),
  ('mercedes_c',  'Mercedes C-Class', 'mid',    14000, 105, 14000),
  ('nissan_altima','Nissan Altima',   'mid',    11000, 105, 11000)
ON CONFLICT (id) DO NOTHING;

-- ---------- genormaliseerd eigendom ----------
CREATE TABLE IF NOT EXISTS public.player_cars (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  catalog_id        text REFERENCES public.car_catalog(id),
  model             text NOT NULL,
  condition         int  NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  tuned             boolean NOT NULL DEFAULT false,
  speed_bonus       int  NOT NULL DEFAULT 0 CHECK (speed_bonus BETWEEN 0 AND 50),
  mods              jsonb NOT NULL DEFAULT '[]'::jsonb,
  base_value        int  NOT NULL DEFAULT 0,
  parts_value_bonus int  NOT NULL DEFAULT 0,   -- geaccumuleerde value uit parts
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_cars_player_idx ON public.player_cars(player_id);

ALTER TABLE public.player_cars ENABLE ROW LEVEL SECURITY;

-- Eigenaar mag zijn eigen auto's LEZEN; schrijven kan alleen via RPC's
-- (geen INSERT/UPDATE/DELETE policy -> directe PostgREST-DML wordt geweigerd,
--  SECURITY DEFINER RPC's omzeilen RLS).
DROP POLICY IF EXISTS player_cars_select_own ON public.player_cars;
CREATE POLICY player_cars_select_own ON public.player_cars
  FOR SELECT USING (player_id = auth.uid());

-- ---------- backfill uit bestaande JSON ----------
-- Match op naam (case-insensitief) tegen de catalogus; base_value komt van
-- de catalogus (de-forge), niet uit de opgeslagen JSON-value. Alleen als er
-- nog geen player_cars-rijen voor de speler bestaan (idempotent-ish).
INSERT INTO public.player_cars
  (player_id, catalog_id, model, condition, tuned, speed_bonus, mods, base_value, parts_value_bonus)
SELECT
  pl.id,
  cat.id,
  COALESCE(elem->>'name', 'Unknown'),
  LEAST(100, GREATEST(0, COALESCE((elem->>'condition')::int, 100))),
  COALESCE((elem->>'tuned')::boolean, false),
  LEAST(50, GREATEST(0, COALESCE((elem->>'speed_bonus')::int, 0))),
  COALESCE(elem->'mods', '[]'::jsonb),
  COALESCE(cat.base_value, LEAST(COALESCE((elem->>'value')::int, 1000), 15000)),
  0
FROM public.players pl
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(pl.cars) = 'array' THEN pl.cars ELSE '[]'::jsonb END
) AS elem
LEFT JOIN public.car_catalog cat
  ON lower(cat.name) = lower(elem->>'name')
WHERE NOT EXISTS (
  SELECT 1 FROM public.player_cars pc WHERE pc.player_id = pl.id
);

-- ---------- read-RPC voor de garage-pagina ----------
-- Levert de auto's + afgeleide (server-authoritative) value, plus garage_level.
CREATE OR REPLACE FUNCTION public.get_garage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  lvl    int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT garage_level INTO lvl FROM public.players WHERE id = auth.uid();

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          pc.id,
      'catalog_id',  pc.catalog_id,
      'name',        pc.model,
      'condition',   pc.condition,
      'tuned',       pc.tuned,
      'speed_bonus', pc.speed_bonus,
      'mods',        pc.mods,
      'value',       pc.base_value + CASE WHEN pc.tuned THEN 2000 ELSE 0 END + pc.parts_value_bonus
    ) ORDER BY pc.created_at
  ), '[]'::jsonb)
  INTO result
  FROM public.player_cars pc
  WHERE pc.player_id = auth.uid();

  RETURN jsonb_build_object(
    'cars',         result,
    'garage_level', COALESCE(lvl, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_garage() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_garage() TO authenticated;
