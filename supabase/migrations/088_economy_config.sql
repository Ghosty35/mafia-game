-- ============================================================
-- 088: Single source of truth for client-displayed economy constants
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- (or `supabase db remote commit`)
--
-- Problem (accuracy / "all UI must be live"): many client components hardcode
-- prices, caps and costs as TS constants (e.g. DRUG_CAPS, WEED_CAP,
-- protection costs, bodyguard costs, heat items, lawyer cost, tuning parts,
-- heist gear/weapons, shed caps/upgrade cost, piggy fee). Those literals are
-- frozen at deploy time — if the economy is ever tuned in the DB, the UI keeps
-- showing the old numbers while the server charges/limits the new ones.
--
-- Fix: expose EVERY canonical constant the UI displays through one RPC,
-- get_economy_config(), derived from the SAME values the RPCs enforce. The
-- client fetches this once (cached) and renders from it, so prices/caps/costs
-- are always live and can be rebalanced without a frontend redeploy.
--
-- NOTE: values below mirror the authoritative RPCs exactly
-- (044 buy_protection, 070 hire_personal_bodyguard, 062 reduce_heat +
-- buy_corrupt_lawyer, 058 buy_heist_gear, 060 buy_weapon + _weapon_bonus,
-- 051 garage_buy_part, 045 _drug_cap, 046 harvest_weed cap, 035 upgrade_shed).
-- If you change a value here, change the enforcing RPC too (and vice versa).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_economy_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN jsonb_build_object(
    -- Drug storage caps (mirror of _drug_cap)
    'drug_caps', jsonb_build_object('Coke', 200, 'Weed', 1000, 'Meth', 100, 'Pills', 300),
    -- Weed total storage cap (mirror of harvest_weed constant 1000)
    'weed_cap', 1000,
    -- Protection shop items (mirror of buy_protection base_cost CASE)
    'protection', jsonb_build_array(
      jsonb_build_object('points', 5,  'cost', 450),
      jsonb_build_object('points', 8,  'cost', 780),
      jsonb_build_object('points', 12, 'cost', 1350)
    ),
    -- Personal bodyguard escalating costs + max (mirror of hire_personal_bodyguard)
    'bodyguard_costs', jsonb_build_array(50000, 100000, 200000, 350000, 500000),
    'bodyguard_max', 5,
    -- Heat-reduction items (mirror of reduce_heat CASE)
    'heat_items', jsonb_build_array(
      jsonb_build_object('key', 'burner',  'price', 5000,  'drop', 20, 'zero', false),
      jsonb_build_object('key', 'bribe',   'price', 25000, 'drop', 50, 'zero', false),
      jsonb_build_object('key', 'lay_low', 'price', 60000, 'drop', 0,  'zero', true)
    ),
    -- Corrupt lawyer one-time cost (mirror of buy_corrupt_lawyer)
    'lawyer_cost', 250000,
    -- Heist gear catalog (mirror of buy_heist_gear CASE)
    'heist_gear', jsonb_build_array(
      jsonb_build_object('tier', 'pistol',  'cost', 450,  'bonus', 8),
      jsonb_build_object('tier', 'kevlar',  'cost', 720,  'bonus', 12),
      jsonb_build_object('tier', 'fullkit', 'cost', 1100, 'bonus', 18)
    ),
    -- Weapon catalog (mirror of buy_weapon + _weapon_bonus)
    'weapons', jsonb_build_array(
      jsonb_build_object('id', 'pistol', 'cost', 2500,  'bonus', 4),
      jsonb_build_object('id', 'smg',    'cost', 12000, 'bonus', 9),
      jsonb_build_object('id', 'rifle',  'cost', 35000, 'bonus', 16)
    ),
    -- Garage tuning parts (mirror of garage_buy_part CASE)
    'tuning_parts', jsonb_build_array(
      jsonb_build_object('part_id', 'engine',  'cost', 2500, 'bonus', 5),
      jsonb_build_object('part_id', 'turbo',   'cost', 4000, 'bonus', 8),
      jsonb_build_object('part_id', 'brakes',  'cost', 1500, 'bonus', 3),
      jsonb_build_object('part_id', 'bodykit', 'cost', 1200, 'bonus', 2)
    ),
    -- Shed capacity by (level, property tier) + upgrade cost + max level
    -- (mirror of upgrade_shed cost = 50000 * level, and safehouse getShedCap)
    'shed', jsonb_build_object(
      'base', 1000,
      'level_multiplier', jsonb_build_object('2', 2500, '3', 3500),
      'tier_multiplier', jsonb_build_object('villa', 1.5, 'mansion', 2.5),
      'upgrade_cost_per_level', 50000,
      'max_level', 3
    ),
    -- Piggy-bank withdrawal fee (mirror of piggy_withdraw floor(amount * 0.008))
    'piggy_fee_pct', 0.008
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_economy_config() TO authenticated;
