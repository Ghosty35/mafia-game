-- 101_security_hardening.sql
-- P1/P2 security fixes from deep-dive audit.

-- ---------- 1) admin_give_cash: enforce server-side admin check ----------
CREATE OR REPLACE FUNCTION public.admin_give_cash(target_username text, amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tgt public.players;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO tgt FROM public.players WHERE username = target_username FOR UPDATE;
  IF tgt.id IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  tgt.cash := GREATEST(0, tgt.cash + amount);
  UPDATE public.players SET cash = tgt.cash WHERE id = tgt.id;
  RETURN to_jsonb(tgt);
END;
$$;

-- ---------- 2) donate_to_family: restore atomic conditional UPDATE ----------
-- Prevents TOCTOU race: concurrent donations can't overdraw cash.
CREATE OR REPLACE FUNCTION public.donate_to_family(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  rows int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  UPDATE public.players
  SET cash = cash - amount
  WHERE id = auth.uid() AND cash >= amount AND amount > 0
  RETURNING 1 INTO rows;

  IF rows = 0 THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.families
  SET pending_bank = pending_bank + amount
  WHERE id = my_family_id;

  RETURN jsonb_build_object('success', true, 'donated', amount);
END;
$$;

-- ---------- 3) buy_family_buff_cash: lock family row FOR UPDATE ----------
CREATE OR REPLACE FUNCTION public.buy_family_buff_cash(cost_cash bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
  fam public.families;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_cash <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  power_gain := GREATEST(5, FLOOR(cost_cash / 8000));

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.cash < cost_cash THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = fam_id FOR UPDATE;

  UPDATE public.players SET cash = cash - cost_cash WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

-- ---------- 4) buy_family_buff_diamonds: lock family row FOR UPDATE ----------
CREATE OR REPLACE FUNCTION public.buy_family_buff_diamonds(cost_diamonds bigint, p_is_bundle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  fam_id uuid;
  power_gain integer;
  rate numeric;
  fam public.families;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF cost_diamonds <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  rate := CASE WHEN p_is_bundle THEN 4.0 ELSE 1.8 END;
  power_gain := FLOOR(cost_diamonds * rate);

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(p.diamonds, 0) < cost_diamonds THEN RAISE EXCEPTION 'NOT_ENOUGH_DIAMONDS'; END IF;

  SELECT family_id INTO fam_id FROM public.family_members WHERE player_id = auth.uid();
  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = fam_id FOR UPDATE;

  UPDATE public.players SET diamonds = diamonds - cost_diamonds WHERE id = p.id;
  UPDATE public.families SET power = COALESCE(power, 0) + power_gain WHERE id = fam_id;

  RETURN jsonb_build_object('success', true, 'power_gain', power_gain);
END;
$$;

-- ---------- 5) attempt_hit: add stamina cost + short cooldown ----------
-- Prevents spam-farming jail cycling and gives a real throttle.
CREATE OR REPLACE FUNCTION public.attempt_hit(target_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  attacker public.players;
  target public.players;
  success_chance numeric;
  succeeded boolean;
  stolen bigint;
  skill_gain numeric := 0.03;
  health_loss numeric;
  hit_cooldown interval := interval '30 seconds';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF auth.uid() = target_player_id THEN RAISE EXCEPTION 'CANNOT_HIT_SELF'; END IF;

  SELECT * INTO attacker FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO target FROM public.players WHERE id = target_player_id FOR UPDATE;

  IF attacker.death_until IS NOT NULL AND attacker.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF attacker.jailed_until IS NOT NULL AND attacker.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF attacker.kill_protected_until IS NOT NULL AND attacker.kill_protected_until > now() THEN RAISE EXCEPTION 'KILL_PROTECTED'; END IF;

  IF attacker.last_action_at IS NOT NULL AND attacker.last_action_at > now() - hit_cooldown THEN
    RAISE EXCEPTION 'ON_COOLDOWN';
  END IF;

  IF COALESCE(attacker.stamina, 0) < 10 THEN RAISE EXCEPTION 'NOT_ENOUGH_STAMINA'; END IF;

  success_chance := LEAST(0.85, GREATEST(0.15, (attacker.murder_skill + 5) / (target.level + 10) * 0.6 ));
  succeeded := random() < success_chance;

  IF succeeded THEN
    health_loss := 2 + random() * 3;
    stolen := FLOOR(target.cash * 0.15 + random() * 200);
    IF stolen > target.cash THEN stolen := target.cash; END IF;

    attacker.dirty_cash := COALESCE(attacker.dirty_cash, 0) + stolen;
    attacker.murder_skill := attacker.murder_skill + skill_gain;
    attacker.heat := LEAST(100, attacker.heat + 15);
    attacker.stamina := GREATEST(0, attacker.stamina - 10);
    attacker.last_action_at := now();

    target.cash := target.cash - stolen;
    target.heat := LEAST(100, target.heat + 10);

    UPDATE public.players SET dirty_cash = attacker.dirty_cash, murder_skill = attacker.murder_skill,
      heat = attacker.heat, heat_updated_at = now(), stamina = attacker.stamina, last_action_at = attacker.last_action_at
      WHERE id = attacker.id;
    UPDATE public.players SET cash = target.cash, heat = target.heat WHERE id = target.id;

    RETURN jsonb_build_object('success', true, 'stolen', stolen, 'skill_gained', skill_gain, 'player', to_jsonb(attacker));
  ELSE
    health_loss := 5 + random() * 10;
    attacker.health := GREATEST(0, attacker.health - health_loss);
    attacker.heat := LEAST(100, attacker.heat + 25);
    attacker.stamina := GREATEST(0, attacker.stamina - 10);
    attacker.last_action_at := now();

    IF attacker.health <= 0 THEN
      attacker.death_until := now() + make_interval(secs => 3600);
      attacker.kill_protected_until := null;
    END IF;

    attacker.jailed_until := now() + make_interval(secs => 300);

    UPDATE public.players SET health = attacker.health, death_until = attacker.death_until,
      heat = attacker.heat, heat_updated_at = now(), jailed_until = attacker.jailed_until,
      stamina = attacker.stamina, last_action_at = attacker.last_action_at WHERE id = attacker.id;

    RETURN jsonb_build_object('success', false, 'jail_time', 300, 'health_lost', health_loss, 'player', to_jsonb(attacker));
  END IF;
END;
$function$;

-- ---------- 6) buy_drug: add DEAD check ----------
CREATE OR REPLACE FUNCTION public.buy_drug(p_drug text, p_qty int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  unit_price int;
  cost bigint;
  tax bigint;
  total bigint;
  have int;
  cap int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  unit_price := public._drug_price(p.current_city, p_drug);
  cost  := unit_price::bigint * p_qty;
  tax   := floor(cost * 0.015)::bigint;
  total := cost + tax;

  IF p.cash < total THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  cap  := public._drug_cap(p_drug);
  IF have + p_qty > cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  new_storage := jsonb_set(
    COALESCE(p.drug_storage, '{}'::jsonb),
    ARRAY[p_drug],
    to_jsonb(have + p_qty)
  );

  UPDATE public.players
  SET cash = cash - total,
      gov_tax_bank = COALESCE(gov_tax_bank, 0) + tax,
      drug_storage = new_storage
  WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty,
                            'unit_price', unit_price, 'tax', tax, 'total', total,
                            'storage', new_storage);
END;
$$;

-- ---------- 7) sell_drug: add DEAD check ----------
CREATE OR REPLACE FUNCTION public.sell_drug(p_drug text, p_qty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  p public.players; unit_price int; revenue bigint; have int; new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public._drug_idx(p_drug) IS NULL THEN RAISE EXCEPTION 'INVALID_DRUG'; END IF;
  IF p_qty < 1 OR p_qty > 100000 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  have := COALESCE((p.drug_storage->>p_drug)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;
  unit_price := public._drug_price(p.current_city, p_drug);
  revenue := unit_price::bigint * p_qty;
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[p_drug], to_jsonb(have - p_qty));
  UPDATE public.players SET dirty_cash = COALESCE(dirty_cash, 0) + revenue, drug_storage = new_storage WHERE id = p.id;
  RETURN jsonb_build_object('success', true, 'drug', p_drug, 'qty', p_qty, 'unit_price', unit_price, 'revenue', revenue, 'storage', new_storage);
END;
$function$;

-- ---------- 8) buy_weapon: add DEAD/IN_JAIL checks ----------
CREATE OR REPLACE FUNCTION public.buy_weapon(weapon_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.players; cost int; label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  CASE weapon_id
    WHEN 'pistol' THEN cost := 2500;  label := 'Pistol';
    WHEN 'smg'    THEN cost := 12000; label := 'SMG';
    WHEN 'rifle'  THEN cost := 35000; label := 'Rifle';
    ELSE RAISE EXCEPTION 'UNKNOWN_WEAPON';
  END CASE;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.weapons ? weapon_id THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
     SET cash = cash - cost,
         weapons = COALESCE(weapons, '[]'::jsonb) || jsonb_build_array(weapon_id)
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'weapon', weapon_id, 'label', label, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_weapon(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_weapon(text) TO authenticated;

-- ---------- 9) buy_heist_gear: add DEAD/IN_JAIL checks ----------
CREATE OR REPLACE FUNCTION public.buy_heist_gear(tier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  cost int;
  bonus int;
  label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  CASE tier
    WHEN 'pistol'  THEN cost := 450;  bonus := 8;  label := 'Street Pistol';
    WHEN 'kevlar'  THEN cost := 720;  bonus := 12; label := 'Kevlar + Tools';
    WHEN 'fullkit' THEN cost := 1100; bonus := 18; label := 'Full Kit';
    ELSE RAISE EXCEPTION 'UNKNOWN_GEAR';
  END CASE;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  UPDATE public.players
     SET cash = cash - cost,
         heist_gear = jsonb_build_object('tier', tier, 'label', label, 'bonus', bonus)
   WHERE id = p.id;

  RETURN jsonb_build_object('success', true, 'tier', tier, 'bonus', bonus, 'cost', cost, 'new_cash', p.cash - cost);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_heist_gear(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_heist_gear(text) TO authenticated;
