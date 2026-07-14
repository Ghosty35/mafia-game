'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';

export default function MetalFactoryPage() {
  const { player, refreshPlayer } = usePlayer();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pricePerBullet = 5; // sharp price

  const buyBullets = async () => {
    if (!player) return;

    setBusy(true);
    const supabase = createClient();

    // Purchase + police risk are enforced server-side (buy_bullets RPC)
    const { data, error } = await supabase.rpc('buy_bullets', { amount });

    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : (error.message || 'Purchase failed.'));
    } else if (data?.busted) {
      await refreshPlayer();
      setMessage(`Police caught you! Fined $${data.fine}, +30 heat, bullets confiscated. 5 min jail risk.`);
    } else {
      await refreshPlayer();
      setMessage(`Bought ${data?.bullets_bought || amount} bullets for $${data?.cost || amount * pricePerBullet}.`);
    }

    setBusy(false);
  };

  if (!player) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏭 Metal Factory</h1>
      <p className="text-sm text-zinc-400 mb-6">Buy illegal bullets. High volume purchases risk police attention.</p>

      <div className="card p-6">
        <div className="mb-4">
          <label className="block text-sm mb-1">Amount of Bullets</label>
          <input 
            type="number" 
            value={amount} 
            onChange={e => setAmount(Math.max(10, parseInt(e.target.value) || 10))}
            className="bg-zinc-900 border border-zinc-700 rounded px-4 py-2 w-full"
          />
        </div>

        <div className="text-sm mb-4">
          Cost: <span className="font-mono">${amount * pricePerBullet}</span> 
          {amount > 5000 && <span className="text-red-400 ml-2">(High risk!)</span>}
        </div>

        <button 
          onClick={buyBullets} 
          disabled={busy}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold"
        >
          {busy ? 'Buying...' : 'Buy Bullets'}
        </button>
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        Current bullets: {player.bullets || 0}. Use in PvP kills.
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
