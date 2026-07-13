'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { CITIES, City } from '@/lib/cities';

const DRUGS = ['Coke', 'Weed', 'Meth', 'Pills'] as const;

type DrugPrices = Record<typeof DRUGS[number], number>;

const DRUG_CAPS: Record<typeof DRUGS[number], number> = {
  Coke: 200,   // limited carry
  Meth: 100,
  Pills: 300,
  Weed: 1000   // higher because growable in shed
};

export default function StreetDealerPage() {
  const { player, updatePlayer, canPerformAction, recordAction } = usePlayer();
  const [prices, setPrices] = useState<DrugPrices>({ Coke: 120, Weed: 80, Meth: 200, Pills: 50 });
  const [city, setCity] = useState<City>('New York');
  const [message, setMessage] = useState('');
  const [drugStorage, setDrugStorage] = useState<Record<string, number>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({}); // for timers like murder, grow
  const [buyQty, setBuyQty] = useState(1);
  const [sellQty, setSellQty] = useState(1);

  const currentCity = (player?.current_city as City) || 'New York';

  // Load live storage and cooldowns
  useEffect(() => {
    if (!player) return;
    const loadData = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_drug_storage');
      if (data) setDrugStorage(data as any);
      // Load murder cooldown etc if in player
      if (player.murder_cooldown) {
        const end = new Date(player.murder_cooldown).getTime();
        const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
        setCooldowns(prev => ({...prev, murder: left}));
      }
    };
    loadData();
  }, [player]);

  // Live countdown for cooldowns
  useEffect(() => {
    const iv = setInterval(() => {
      setCooldowns(prev => {
        const next: any = {};
        Object.keys(prev).forEach(k => {
          next[k] = Math.max(0, prev[k] - 1);
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Dynamic prices designed for profitable drug runs (buy low in one city, sell high in another)
  // Prices shift every 4 hours. Different cities have advantages.
  useEffect(() => {
    const getCityMultipliers = (c: City) => {
      // Base multipliers to create buy-low-sell-high opportunities
      switch (c) {
        case 'New York': return { Coke: 0.7, Weed: 1.3, Meth: 1.1, Pills: 0.9 };
        case 'Chicago': return { Coke: 1.4, Weed: 0.8, Meth: 0.9, Pills: 1.2 };
        case 'Los Angeles': return { Coke: 1.1, Weed: 0.6, Meth: 1.4, Pills: 0.8 };
        case 'Miami': return { Coke: 0.9, Weed: 1.2, Meth: 0.7, Pills: 1.5 };
        case 'Las Vegas': return { Coke: 1.3, Weed: 1.0, Meth: 1.2, Pills: 0.7 };
        default: return { Coke: 1, Weed: 1, Meth: 1, Pills: 1 };
      }
    };

    const updatePrices = () => {
      const mult = getCityMultipliers(currentCity);
      const newPrices: DrugPrices = {
        Coke: Math.floor(90 * mult.Coke + Math.random() * 40),
        Weed: Math.floor(55 * mult.Weed + Math.random() * 30),
        Meth: Math.floor(160 * mult.Meth + Math.random() * 60),
        Pills: Math.floor(35 * mult.Pills + Math.random() * 25),
      };
      setPrices(newPrices);
      setMessage(`Street prices updated in ${currentCity}. Look for profitable runs!`);
    };

    updatePrices();

    const interval = setInterval(updatePrices, 4 * 60 * 60 * 1000); // 4 hours
    return () => clearInterval(interval);
  }, [currentCity]);

  const buyDrug = (drug: typeof DRUGS[number], qty?: number) => {
    const amount = qty || buyQty;
    if (!player || amount < 1) return;
    if (!canPerformAction()) {
      setMessage('Please wait 2 seconds between actions/transactions.');
      return;
    }
    recordAction();
    const cost = prices[drug] * amount;
    const tax = Math.floor(cost * 0.015); // 1.5% tax to Community Tax Fund
    const total = cost + tax;
    if (player.cash < total) {
      setMessage('Not enough cash (incl. 1.5% tax to Fund)!');
      return;
    }
    const current = drugStorage[drug] || 0;
    if (current + amount > DRUG_CAPS[drug]) {
      setMessage(`Carry cap reached for ${drug}! Max ${DRUG_CAPS[drug]} kg. (Weed higher due to growing.)`);
      return;
    }
    const newStorage = { ...drugStorage, [drug]: current + amount };
    setDrugStorage(newStorage);
    const updated = { ...player, cash: player.cash - total, drug_storage: newStorage };
    updatePlayer(updated as any);
    setMessage(`Bought ${amount} ${drug} for $${total} (incl tax). Sell high in another city!`);
  };

  const sellDrug = (drug: typeof DRUGS[number], qty: number) => {
    const current = drugStorage[drug] || 0;
    if (current < qty) {
      setMessage('Not enough in shed!');
      return;
    }
    const revenue = Math.floor(prices[drug] * qty);
    const newStorage = { ...drugStorage, [drug]: current - qty };
    setDrugStorage(newStorage);
    const updated = { ...player, cash: (player?.cash || 0) + revenue, drug_storage: newStorage };
    updatePlayer(updated as any);
    setMessage(`Sold ${qty} ${drug} for $${revenue}. Profit from the run!`);
  };

  if (!player) return <div>Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <img src="https://picsum.photos/id/201/800/120" alt="Street Dealer" className="w-full h-24 object-cover rounded mb-4" />
      <h1 className="text-3xl font-bold mb-2">💊 Street Dealer - {currentCity}</h1>
      <p className="text-sm text-zinc-400 mb-4">Prices change every 4 hours per city. Buy low, sell high in other cities for big profits (hidden drug economy). Tax 1.5% to Community Fund.</p>

      {/* Live Drug Storage Tracker */}
      <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">
        <div className="text-sm font-semibold mb-1">Your Shed Storage</div>
        <div className="flex flex-wrap gap-4 text-xs">
          {DRUGS.map(d => (
            <span key={d}>{d}: <span className="font-mono text-emerald-400">{drugStorage[d] || 0} kg</span> / {DRUG_CAPS[d]}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {DRUGS.map(drug => (
          <div key={drug} className="card p-4">
            {drug === 'Coke' && <img src="https://picsum.photos/id/201/300/80" alt="Coke" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Weed' && <img src="https://picsum.photos/id/160/300/80" alt="Weed" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Meth' && <img src="https://picsum.photos/id/251/300/80" alt="Meth" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Pills' && <img src="https://picsum.photos/id/180/300/80" alt="Pills" className="w-full h-16 object-cover rounded mb-2" />}
            <h3 className="font-bold">{drug}</h3>
            <div className="text-2xl font-mono text-emerald-400 my-2">${prices[drug]}</div>
            <div className="flex gap-2">
              <button onClick={() => buyDrug(drug)} className="flex-1 py-1 bg-red-700 rounded text-xs">Buy {buyQty}</button>
              <button onClick={() => sellDrug(drug, sellQty)} className="flex-1 py-1 bg-emerald-700 rounded text-xs">Sell {sellQty}</button>
            </div>
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>}

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
