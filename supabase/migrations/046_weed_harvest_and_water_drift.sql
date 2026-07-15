-- 046_weed_harvest_and_water_drift.sql
-- =====================================================================
-- FASE 1 / Spoor A3 — Weed: drift onder versiebeheer + server-side harvest
-- ---------------------------------------------------------------------
-- 1) water_weed_plant() stond alleen op de live DB (migration drift).
--    Hier vastgelegd VERBATIM zoals live, zodat de migratie-historie klopt.
-- 2) harvest_weed() vervangt de client-authoritative apply_action-harvest:
--    kg wordt nu server-side berekend uit property-type + kwaliteit, met
--    server-side cap. Sluit het "schrijf zelf je drug_storage"-lek voor weed.
-- =====================================================================

-- Kolom-guard (bestaat al live; idempotent voor verse databases).
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS weed_last_watered timestamptz;


-- ---------- 1) water_weed_plant (verbatim uit live DB) ----------
CREATE OR REPLACE FUNCTION public.water_weed_plant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  p public.players;
  success boolean;
  change int;
  new_percent int;
  new_progress int;
  current_quality int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if coalesce(p.weed_progress, 0) >= 5 then
    raise exception 'MAX_PROGRESS';
  end if;

  if p.weed_last_watered is not null and p.weed_last_watered > now() - interval '1 hour' then
    raise exception 'ON_COOLDOWN';
  end if;

  current_quality := coalesce((p.weed_plants->>'quality')::int, 100);

  success := random() > 0.3;
  change := case when success then 15 else -10 end;
  new_percent := greatest(-50, least(200, current_quality + change));
  new_progress := least(5, coalesce(p.weed_progress, 0) + 1);

  update public.players
  set weed_progress = new_progress,
      weed_plants = jsonb_set(coalesce(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(new_percent)),
      weed_last_watered = now()
  where id = p.id;

  return jsonb_build_object(
    'success', success,
    'change', change,
    'new_percent', new_percent,
    'new_progress', new_progress
  );
end;
$function$;


-- ---------- 2) harvest_weed (server-authoritative) ----------
-- kg = base(property) * quality-multiplier, server-side. Cap 1000 kg Weed.
CREATE OR REPLACE FUNCTION public.harvest_weed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  has_house   boolean;
  has_villa   boolean;
  has_mansion boolean;
  kg_base int;
  quality int;
  q_mult numeric;
  kg int;
  have int;
  new_storage jsonb;
  cap constant int := 1000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  -- Grow-spot detectie uit owned_properties (server-side, niet te faken).
  SELECT
    bool_or(lower(el->>'name') LIKE '%house%'   OR lower(el->>'name') LIKE '%villa%' OR lower(el->>'name') LIKE '%mansion%'),
    bool_or(lower(el->>'name') LIKE '%villa%'),
    bool_or(lower(el->>'name') LIKE '%mansion%')
  INTO has_house, has_villa, has_mansion
  FROM jsonb_array_elements(COALESCE(p.owned_properties, '[]'::jsonb)) AS el;

  IF NOT COALESCE(has_house, false) THEN RAISE EXCEPTION 'NO_GROW_SPOT'; END IF;

  IF COALESCE(p.weed_progress, 0) < 4 THEN RAISE EXCEPTION 'NEED_PROGRESS'; END IF;

  kg_base := CASE WHEN has_mansion THEN 250 WHEN has_villa THEN 120 ELSE 40 END;
  quality := COALESCE((p.weed_plants->>'quality')::int, 100);

  -- Kwaliteit onder 0 = mislukte oogst; plant vernietigd, niets geoogst.
  IF quality < 0 THEN
    UPDATE public.players
    SET weed_progress = 0,
        weed_plants = jsonb_set(COALESCE(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(100)),
        failed_harvest_kg = COALESCE(failed_harvest_kg, 0) + kg_base
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'destroyed', true);
  END IF;

  q_mult := GREATEST(0.1, quality::numeric / 100.0);
  kg := floor(kg_base * q_mult)::int;

  have := COALESCE((p.drug_storage->>'Weed')::int, 0);
  IF have + kg > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), '{Weed}', to_jsonb(have + kg));

  UPDATE public.players
  SET weed_progress = 0,
      weed_plants = jsonb_set(COALESCE(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(100)),
      drug_storage = new_storage,
      successful_harvest_kg = COALESCE(successful_harvest_kg, 0) + kg
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'kg', kg, 'quality', quality, 'storage', new_storage);
END;
$$;
