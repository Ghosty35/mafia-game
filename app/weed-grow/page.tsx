'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';

export default function WeedGrowPage() {
  const { player, updatePlayer } = usePlayer();
  const [weedProgress, setWeedProgress] = useState(0);
  const [harvestPercent, setHarvestPercent] = useState(100);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const owned = player?.owned_properties || [];
  const hasHouse = owned.some((p: any) => p.name && (p.name.toLowerCase().includes('house') || p.name.toLowerCase().includes('villa') || p.name.toLowerCase().includes('mansion')));
  const hasVilla = owned.some((p: any) => p.name && p.name.toLowerCase().includes('villa'));
  const hasMansion = owned.some((p: any) => p.name && p.name.toLowerCase().includes('mansion'));

  useEffect(() => {
    if (player?.weed_progress !== undefined) setWeedProgress(player.weed_progress);
    // load harvest % if stored, default 100
    // for demo, use state
  }, [player]);

  const waterPlant = async () => {
    if (!player || !hasHouse || busy) return;
    if (weedProgress >= 5) {
      setMessage('Already at max progress. Harvest first.');
      return;
    }
    setBusy(true);
    // Simulate water: 70% success +15%, 30% fail -10%
    const success = Math.random() > 0.3;
    let change = success ? 15 : -10;
    const newPercent = Math.max(-50, Math.min(200, harvestPercent + change));
    const newProgress = Math.min(5, weedProgress + 1);

    setHarvestPercent(newPercent);
    setWeedProgress(newProgress);

    const updated = { 
      ...player, 
      weed_progress: newProgress 
    };
    updatePlayer(updated as any);

    setMessage(success 
      ? `Watered successfully! Gained +${change}% harvest quality. Current: ${newPercent}%` 
      : `Water failed! Lost ${Math.abs(change)}% harvest quality. Current: ${newPercent}%`);

    setBusy(false);
  };

  const WEED_CAP = 1000;
  const harvest = () => {
    if (!player || weedProgress < 4) {
      setMessage('Need at least 4/5 progress to harvest.');
      return;
    }
    const kgBase = hasMansion ? 250 : hasVilla ? 120 : 40;
    const qualityMult = Math.max(0.1, harvestPercent / 100);
    const kg = Math.floor(kgBase * qualityMult);

    const current = player.drug_storage?.Weed || 0;
    if (current + kg > WEED_CAP) {
      setMessage(`Shed cap reached! Max ${WEED_CAP}kg weed. Sell some first.`);
      return;
    }

    if (harvestPercent < 0) {
      setMessage('Harvest destroyed due to negative quality! All progress lost.');
      const updated = { ...player, weed_progress: 0 };
      updatePlayer(updated as any);
      setWeedProgress(0);
      setHarvestPercent(100);
      return;
    }

    const storage = player.drug_storage || {};
    const newStorage = { ...storage, Weed: (storage.Weed || 0) + kg };

    const updated = { ...player, weed_progress: 0, drug_storage: newStorage };
    updatePlayer(updated as any);
    setWeedProgress(0);
    setHarvestPercent(100);

    setMessage(`Harvested ${kg}kg Weed at ${harvestPercent}% quality! Added to storage.`);
  };

  if (!player) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🌱 Weed Grow</h1>
      <p className="text-sm text-zinc-400 mb-6">Grow your own in safehouse. Water for quality % (can fail and go negative = destroyed).</p>

      {!hasHouse && <p className="text-amber-400">Buy a House/Villa/Mansion in Real Estate to grow.</p>}

      {hasHouse && (
        <div className="card p-6">
          <div className="mb-4">
            <div>Progress: {weedProgress}/5</div>
            <div className="w-full bg-zinc-800 h-3 rounded mt-1">
              <div className="bg-emerald-600 h-3 rounded" style={{width: `${(weedProgress/5)*100}%`}} />
            </div>
            <div className="mt-2 text-lg">Current Harvest Quality: <span className={harvestPercent < 0 ? 'text-red-500' : 'text-emerald-400'}>{harvestPercent}%</span></div>
          </div>

          <div className="flex gap-3 mb-4">
            <button onClick={waterPlant} disabled={busy || weedProgress >=5} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              Water Plants
            </button>
            <button onClick={harvest} disabled={weedProgress < 4} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              Harvest (min 4/5)
            </button>
          </div>

          <p className="text-xs text-zinc-500">Water 4-5 times. Each water: ~70% +15% quality, 30% -10%. Final % determines yield. Negative = destroyed.</p>
        </div>
      )}

      {message && <div className="mt-4 p-3 bg-zinc-900 rounded">{message}</div>}

      <Link href="/street-dealer" className="mt-6 inline-block text-sm text-red-400">← Back to Street Dealer</Link>
    </div>
  );
}
