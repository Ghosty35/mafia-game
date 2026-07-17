'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type GarageCar = {
  id: string;
  catalog_id?: string;
  name: string;
  condition: number;
  value: number;
  tuned: boolean;
  speed_bonus?: number;
  mods?: string[];
  fuel: number;
  fuel_tank: number;
};

// Shared garage state for /garage, /garage/tune-shop and /garage/junkyard.
// Everything here is server-authoritative (get_garage); the client only reads.
export function useGarage() {
  const [cars, setCars] = useState<GarageCar[]>([]);
  const [garageLevel, setGarageLevel] = useState(0);
  const [fuelPrice, setFuelPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_garage');
    if (!error && data) {
      setCars((data.cars as GarageCar[]) || []);
      setGarageLevel((data.garage_level as number) || 0);
      setFuelPrice((data.fuel_price as number) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { cars, garageLevel, fuelPrice, loading, reload };
}

/** Max cars by property tier — mirrors garage_buy_car's server-side rule. */
export function maxCarsFor(
  ownedProperties: Array<{ name: string }> | undefined,
  garageLevel: number,
): number {
  const props = ownedProperties ?? [];
  if (props.some((p) => p.name.includes('Mansion'))) return 8 + garageLevel * 10;
  if (props.some((p) => p.name.includes('Villa'))) return 4 + garageLevel * 4;
  if (props.some((p) => p.name.includes('House'))) return 2;
  return 0;
}
