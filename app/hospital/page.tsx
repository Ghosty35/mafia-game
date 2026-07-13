'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function HospitalPage() {
  const { t } = useLanguage();
  const [currentHealth, setCurrentHealth] = useState(100);
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();

  // Load current health
  useEffect(() => {
    const loadHealth = async () => {
      const { data: player } = await supabase.rpc('get_my_player');
      if (player?.health != null) {
        setCurrentHealth(player.health);
        setAmount(Math.max(1, 100 - player.health));
      }
    };
    loadHealth();
  }, []);

  const maxAmount = Math.max(0, 100 - currentHealth);
  const totalCost = amount * 8; // $8 per health unit (balanced)

  const handleAmountChange = (newAmount: number) => {
    const clamped = Math.max(1, Math.min(newAmount, maxAmount));
    setAmount(clamped);
  };

  const fillToFull = () => {
    if (maxAmount > 0) {
      setAmount(maxAmount);
    }
  };

  const quickAdd = (add: number) => {
    handleAmountChange(amount + add);
  };

  const buyHealth = async () => {
    if (amount < 1 || amount > maxAmount || currentHealth >= 100) return;

    setBusy(true);
    setMessage(null);

    const { data, error } = await supabase.rpc('buy_health', { amount });

    if (error) {
      let msg = 'Something went wrong.';
      if (error.message.includes('NOT_ENOUGH_CASH')) msg = 'Not enough cash!';
      if (error.message.includes('ALREADY_FULL_HEALTH')) msg = 'You are already at full health.';
      setMessage(msg);
    } else {
      const healed = data?.healed || amount;
      const newHealth = Math.min(100, currentHealth + healed);
      setCurrentHealth(newHealth);
      setAmount(Math.max(1, 100 - newHealth));
      setMessage(`Successfully bought ${healed} health for $${data?.cost || totalCost}!`);
    }

    setBusy(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🏥 Hospital</h1>
        <p className="text-sm text-zinc-400">Buy blood to restore your health. The streets are dangerous.</p>
      </div>

      {/* Current Health */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-zinc-400">Current Health</span>
          <span className="text-2xl font-bold text-emerald-400">{currentHealth}%</span>
        </div>
        <div className="h-4 bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className={`h-4 transition-all ${currentHealth > 60 ? 'bg-emerald-500' : currentHealth > 30 ? 'bg-yellow-500' : 'bg-red-500'}`} 
            style={{ width: `${currentHealth}%` }} 
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1.5">Health drops every time you commit a crime. Higher risk jobs cost more.</p>
      </div>

      {/* Flexible Purchase */}
      <div className="card p-6">
        <h2 className="font-semibold mb-4">Purchase Health</h2>

        <div className="mb-4">
          <label className="block text-sm text-zinc-400 mb-1.5">
            How much health do you want to buy? (max {maxAmount})
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(parseInt(e.target.value) || 1)}
              min={1}
              max={maxAmount}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:border-red-700"
            />
            <button
              onClick={fillToFull}
              disabled={maxAmount <= 0}
              className="px-5 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold whitespace-nowrap disabled:opacity-50"
            >
              Fill to 100%
            </button>
          </div>
        </div>

        {/* Quick Buttons - Bulletstar style quick purchase */}
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={() => quickAdd(10)} className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700">+10</button>
          <button onClick={() => quickAdd(25)} className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700">+25</button>
          <button onClick={() => quickAdd(50)} className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700">+50</button>
          <button onClick={fillToFull} disabled={maxAmount <= 0} className="px-3 py-1 text-xs rounded bg-amber-900 hover:bg-amber-800">Full Restore</button>
        </div>

        {/* Live Cost Preview */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-5">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Amount</span>
            <span className="font-mono">{amount} health</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-zinc-400">Price</span>
            <span className="font-mono text-emerald-400">${totalCost}</span>
          </div>
          <div className="flex justify-between text-sm mt-1 pt-1 border-t border-zinc-800">
            <span className="text-zinc-400">After purchase</span>
            <span className="font-mono text-emerald-400">{Math.min(100, currentHealth + amount)}%</span>
          </div>
        </div>

        <button
          onClick={buyHealth}
          disabled={busy || amount < 1 || amount > maxAmount || currentHealth >= 100}
          className="w-full py-3 rounded-lg bg-red-700 hover:bg-red-600 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {busy ? 'Purchasing...' : `Buy ${amount} Health for $${totalCost}`}
        </button>

        {message && (
          <div className="mt-4 p-3 rounded bg-zinc-900 border border-zinc-700 text-sm text-center">
            {message}
          </div>
        )}
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        Price: $8 per health unit. Enter any amount or use quick buttons to fill exactly what you need.
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400 hover:underline">
        ← Back to Dashboard
      </Link>
    </div>
  );
}
