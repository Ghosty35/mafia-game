'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Single source of truth for client-displayed economy constants.
// Mirrors the authoritative values in migration 088 / get_economy_config().
// The server is still the enforcer — this is only for *display*, so the UI
// shows exactly what the server will charge/limit without hardcoding literals.

export type EconomyConfig = {
  drug_caps: Record<string, number>;
  weed_cap: number;
  protection: Array<{ points: number; cost: number }>;
  bodyguard_costs: number[];
  bodyguard_max: number;
  heat_items: Array<{ key: string; price: number; drop: number; zero: boolean }>;
  lawyer_cost: number;
  heist_gear: Array<{ tier: string; cost: number; bonus: number }>;
  weapons: Array<{ id: string; cost: number; bonus: number }>;
  tuning_parts: Array<{ part_id: string; cost: number; bonus: number }>;
  shed: {
    base: number;
    level_multiplier: Record<string, number>;
    tier_multiplier: Record<string, number>;
    upgrade_cost_per_level: number;
    max_level: number;
  };
  piggy_fee_pct: number;
  family_buff: {
    cash_per_power: number;
    diamond_rate: number;
    diamond_bundle_rate: number;
    min_power: number;
  };
  vip_donator_cost: number;
  family_buffs: Array<{ id: string; label?: string; desc?: string; cash: number; diamonds: number; diamonds_bundle: number }>;
  crush_bullets: number;
  power_packs: Array<{ power: number; price: number; labelKey: string }>;
  druglab: {
    buy_cost: number;
    buy_tax_rate: number;
    upgrade_base: number;
    max_level: number;
    cap_hours: number;
    coke_rate: number;
    meth_rate: number;
    pills_rate: number;
    guard_costs: number[];
    bribe_base: number;
    bribe_rate: number;
    bribe_max: number;
  };
  metal_factory: {
    capacity: number;
    refill_per_hour: number;
  };
  red_light: {
    cap_total: number;
    buy_cost: number;
  };
  login_bonus: {
    cycle: number[];
  };
  family: {
    creation_cash: number;
    power_min_spend: number;
  };
};

// Module-level cache: one RPC call shared by every component that mounts.
let _configPromise: Promise<EconomyConfig | null> | null = null;

function loadConfig(): Promise<EconomyConfig | null> {
  if (!_configPromise) {
    _configPromise = (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.rpc('get_economy_config');
        return (data as EconomyConfig) ?? null;
      } catch {
        return null;
      }
    })();
  }
  return _configPromise;
}

export function useEconomy(): EconomyConfig | null {
  const [config, setConfig] = useState<EconomyConfig | null>(null);

  useEffect(() => {
    let active = true;
    loadConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}

// Synchronous accessor for code that already has a config in hand.
export function getEconomySync(): Promise<EconomyConfig | null> {
  return loadConfig();
}
