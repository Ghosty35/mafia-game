-- ============================================================
-- 089: expose family-buff power rates in get_economy_config()
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- (or `supabase db remote commit`)
--
-- Mirrors the rates hard-coded in migration 086 (buy_family_buff_cash /
-- buy_family_buff_diamonds) so the VIP store preview can show the exact
-- family-power gain the server will award — no client-side multiplier.
--
--   cash:          power = GREATEST(5, FLOOR(cost_cash / 8000))
--   diamonds:      power = FLOOR(cost_diamonds * 1.8)
--   diamonds bundle: power = FLOOR(cost_diamonds * 4.0)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_economy_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cfg jsonb;
BEGIN
  -- Rebuild the full config (kept in sync with migration 088).
  cfg := jsonb_build_object(
    'drug_caps', jsonb_build_object('Coke', 200, 'Weed', 1000, 'Meth', 100, 'Pills', 300),
    'weed_cap', 1000,
    'protection', jsonb_build_array(
      jsonb_build_object('points', 5,  'cost', 450),
      jsonb_build_object('points', 8,  'cost', 780),
      jsonb_build_object('points', 12, 'cost', 1350)
    ),
    'bodyguard_costs', jsonb_build_array(50000, 100000, 200000, 350000, 500000),
    'bodyguard_max', 5,
    'heat_items', jsonb_build_array(
      jsonb_build_object('key', 'burner',  'price', 5000,  'drop', 20, 'zero', false),
      jsonb_build_object('key', 'bribe',   'price', 25000, 'drop', 50, 'zero', false),
      jsonb_build_object('key', 'lay_low', 'price', 60000, 'drop', 0,  'zero', true)
    ),
    'lawyer_cost', 250000,
    'heist_gear', jsonb_build_array(
      jsonb_build_object('tier', 'pistol',  'cost', 450,  'bonus', 8),
      jsonb_build_object('tier', 'kevlar',  'cost', 720,  'bonus', 12),
      jsonb_build_object('tier', 'fullkit', 'cost', 1100, 'bonus', 18)
    ),
    'weapons', jsonb_build_array(
      jsonb_build_object('id', 'pistol', 'cost', 2500,  'bonus', 4),
      jsonb_build_object('id', 'smg',    'cost', 12000, 'bonus', 9),
      jsonb_build_object('id', 'rifle',  'cost', 35000, 'bonus', 16)
    ),
    'tuning_parts', jsonb_build_array(
      jsonb_build_object('part_id', 'engine',  'cost', 2500, 'bonus', 5),
      jsonb_build_object('part_id', 'turbo',   'cost', 4000, 'bonus', 8),
      jsonb_build_object('part_id', 'brakes',  'cost', 1500, 'bonus', 3),
      jsonb_build_object('part_id', 'bodykit', 'cost', 1200, 'bonus', 2)
    ),
    'shed', jsonb_build_object(
      'base', 1000,
      'level_multiplier', jsonb_build_object('2', 2500, '3', 3500),
      'tier_multiplier', jsonb_build_object('villa', 1.5, 'mansion', 2.5),
      'upgrade_cost_per_level', 50000,
      'max_level', 3
    ),
    'piggy_fee_pct', 0.008,
    -- Family-buff power rates (mirror migration 086).
    'family_buff', jsonb_build_object(
      'cash_per_power', 8000,
      'diamond_rate', 1.8,
      'diamond_bundle_rate', 4.0,
      'min_power', 5
    )
  );
  RETURN cfg;
END;
$$;
