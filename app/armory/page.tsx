'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const powerPacks = [
  { power: 50, price: 1200, label: 'Basic Firepower' },      // balanced
  { power: 150, price: 3500, label: 'Street Arsenal' },
  { power: 400, price: 8500, label: 'Heavy Artillery' },
  { power: 1000, price: 18000, label: 'Warlord Package' },
];

export default function ArmoryPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const buyPower = async (power: number, price: number) => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('buy_power', {
      power_amount: power,
      cost: price
    });

    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : 'Purchase failed.');
    } else {
      setMessage(`+${power} Power purchased for $${price}!`);
    }
    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🔫 Armory</h1>
        <p className="text-sm text-zinc-400">Purchase raw power and buffs. Affects heists, crimes and PvP.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {powerPacks.map((pack, i) => (
          <div key={i} className="card p-5">
            <div className="text-3xl mb-2">⚔️</div>
            <h3 className="font-bold text-lg mb-1">{pack.label}</h3>
            <div className="text-emerald-400 font-mono mb-3">+{pack.power} Power</div>
            <div className="flex justify-between items-center">
              <span className="text-lg font-mono">${pack.price}</span>
              <button 
                onClick={() => buyPower(pack.power, pack.price)}
                disabled={busy}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold disabled:opacity-50"
              >
                Buy Power
              </button>
            </div>
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        Power increases your overall strength. Higher power = better leaderboard position and slight heist bonuses.
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
