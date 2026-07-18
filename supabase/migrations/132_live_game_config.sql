-- 132_live_game_config.sql
-- =====================================================================
-- LIVE ECONOMY CONFIG — make hardcoded balance constants tunable online
-- without a redeploy, with ZERO regression risk.
--
-- Pattern: _cfg(key, default) returns the admin-set override if present,
-- otherwise the passed default (= the current hardcoded value). So wiring
-- _cfg('bullet_cap', 10000) in place of `10000` behaves IDENTICALLY until an
-- admin sets bullet_cap. Nothing can silently change under live players.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.game_config (
  key         text PRIMARY KEY,
  num         numeric NOT NULL,
  label       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
ALTER TABLE public.game_config ENABLE ROW LEVEL SECURITY;
-- Values are readable (they're just game balance), but writes are admin-only
-- and go through admin_set_config (RPC). No client write policy.
DROP POLICY IF EXISTS game_config_select ON public.game_config;
CREATE POLICY game_config_select ON public.game_config FOR SELECT USING (true);

-- Reader: override-or-default. STABLE + pinned search_path.
CREATE OR REPLACE FUNCTION public._cfg(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT num FROM public.game_config WHERE key = p_key), p_default);
$$;

-- Admin: read every knob (seeded rows below show current values).
CREATE OR REPLACE FUNCTION public.admin_get_config()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('key', key, 'num', num, 'label', label, 'updated_at', updated_at)
                     ORDER BY key)
    FROM public.game_config), '[]'::jsonb);
END;
$$;

-- Admin: set/override a knob.
CREATE OR REPLACE FUNCTION public.admin_set_config(p_key text, p_value numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN RAISE EXCEPTION 'INVALID_KEY'; END IF;
  INSERT INTO public.game_config (key, num, updated_at, updated_by)
  VALUES (p_key, p_value, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE SET num = EXCLUDED.num, updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('success', true, 'key', p_key, 'num', p_value);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_config() FROM public;
REVOKE ALL ON FUNCTION public.admin_set_config(text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_config(text, numeric) TO authenticated;

-- Seed the first batch of knobs at their CURRENT values so the admin editor
-- lists them. Seeding = current default, so behaviour is unchanged.
INSERT INTO public.game_config (key, num, label) VALUES
  ('bullet_cap',            10000, 'Max bullets a player can hold'),
  ('bullet_bust_threshold', 5000,  'Bullets/purchase that triggers a police bust'),
  ('family_hourly_cap',     500,   'Max family hourly base pay rate')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Wire the first batch. Bodies are byte-for-byte the live versions with only
-- the literals swapped for _cfg(..., <same literal>).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buy_bullets(amount integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  p public.players;
  f public.bullet_factory;
  unit_price int;
  bought int;
  total_cost bigint;
  fine bigint;
  MAX_BULLETS int := public._cfg('bullet_cap', 10000)::int;
  BUST_AT int := public._cfg('bullet_bust_threshold', 5000)::int;
  space_left int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF amount < 10 THEN RAISE EXCEPTION 'MIN_10_BULLETS'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  space_left := GREATEST(0, MAX_BULLETS - COALESCE(p.bullets, 0));
  IF space_left <= 0 THEN RAISE EXCEPTION 'BULLET_CAP_REACHED'; END IF;

  IF amount > BUST_AT THEN
    fine := floor(amount * 0.8)::bigint;
    UPDATE public.players
    SET cash = GREATEST(0, cash - fine),
        heat = LEAST(100, COALESCE(heat, 0) + 30),
        heat_updated_at = now(),
        bullets = LEAST(MAX_BULLETS, GREATEST(0, COALESCE(bullets, 0) - floor(amount * 0.6)::bigint))
    WHERE id = p.id;
    RETURN jsonb_build_object('success', false, 'busted', true, 'fine', fine);
  END IF;

  f := public._factory_refill();
  IF f.stock <= 0 THEN RAISE EXCEPTION 'FACTORY_EMPTY'; END IF;

  bought := LEAST(amount, f.stock, space_left);
  unit_price := public._bullet_price(f.stock, f.capacity);
  total_cost := bought::bigint * unit_price;
  IF p.cash < total_cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
  SET cash = cash - total_cost,
      bullets = LEAST(MAX_BULLETS, COALESCE(bullets, 0) + bought)
  WHERE id = p.id;

  UPDATE public.bullet_factory SET stock = stock - bought WHERE id = 1;

  RETURN jsonb_build_object(
    'success', true, 'bullets_bought', bought, 'requested', amount,
    'unit_price', unit_price, 'cost', total_cost, 'stock_left', f.stock - bought,
    'cap', MAX_BULLETS
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_family_hourly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  my_family_id uuid; fam record; hours_elapsed numeric; base_hourly bigint;
  member_pay bigint; pay_bank bigint; pay_cash bigint; last_claim timestamptz;
  hourly_cap bigint := public._cfg('family_hourly_cap', 500)::bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT family_id, last_family_claim_at INTO my_family_id, last_claim
    FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  SELECT * INTO fam FROM public.families WHERE id = my_family_id;
  base_hourly := GREATEST(1, floor( (fam.power / 200.0) + (fam.bank / 500000.0) ));
  IF base_hourly > hourly_cap THEN base_hourly := hourly_cap; END IF;
  hours_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(last_claim, now() - interval '1 hour'))) / 3600);
  IF hours_elapsed > 48 THEN hours_elapsed := 48; END IF;
  member_pay := floor(base_hourly * hours_elapsed);
  IF member_pay < 1 THEN RETURN jsonb_build_object('success', false, 'reason', 'NO_PAY_DUE', 'hours', hours_elapsed); END IF;
  pay_bank := floor(member_pay * 0.60);
  pay_cash := member_pay - pay_bank;
  UPDATE public.players
  SET cash = cash + pay_cash, personal_bank = COALESCE(personal_bank, 0) + pay_bank, last_family_claim_at = now(), last_active = now()
  WHERE id = auth.uid();
  RETURN jsonb_build_object('success', true, 'hours', round(hours_elapsed, 1), 'total_pay', member_pay, 'bank_deposit', pay_bank, 'cash_deposit', pay_cash, 'family_power', fam.power);
END;
$function$;

COMMIT;
