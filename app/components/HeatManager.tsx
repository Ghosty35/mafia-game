'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';

// Mirrors the server catalog in migration 062 (reduce_heat / buy_corrupt_lawyer).
const HEAT_ITEMS: Array<{ key: string; label: string; emoji: string; desc: string; price: number }> = [
  { key: 'burner', label: 'Burner Phone', emoji: '📱', desc: '−20 heat', price: 5000 },
  { key: 'bribe', label: 'Bribe a Cop', emoji: '🤝', desc: '−50 heat', price: 25000 },
  { key: 'lay_low', label: 'Lay Low', emoji: '🕶️', desc: 'heat → 0', price: 60000 },
];
const LAWYER_COST = 250000;

type Variant = 'full' | 'store' | 'laylow';

function heatColor(heat: number) {
  if (heat >= 75) return 'bg-red-600';
  if (heat >= 40) return 'bg-orange-500';
  if (heat >= 20) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

export default function HeatManager({ variant = 'full' }: { variant?: Variant }) {
  const { player, refreshPlayer, showToast } = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);

  if (!player) return null;

  const heat = player.heat ?? 0;
  const mostWanted = heat >= 75;
  const hasLawyer = !!player.has_corrupt_lawyer;
  const cash = player.cash ?? 0;

  const mapErr = (msg: string) =>
    msg.includes('NO_HEAT')
      ? 'You have no heat to cool down.'
      : msg.includes('NOT_ENOUGH_CASH')
        ? 'Not enough cash for that.'
        : msg.includes('ALREADY_OWNED')
          ? 'You already have a corrupt lawyer on retainer.'
          : msg;

  const buyItem = async (key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('reduce_heat', { item_key: key });
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      showToast(`${data.label}: heat is now ${data.new_heat}`, 'success');
      if (refreshPlayer) await refreshPlayer();
    } finally {
      setBusy(null);
    }
  };

  const buyLawyer = async () => {
    if (busy) return;
    setBusy('lawyer');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('buy_corrupt_lawyer');
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      showToast('Corrupt Lawyer retained — your heat now cools 50% faster.', 'success');
      if (refreshPlayer) await refreshPlayer();
    } finally {
      setBusy(null);
    }
  };

  const itemButtons = (
    <div className="flex flex-wrap gap-2">
      {HEAT_ITEMS.map((it) => (
        <button
          key={it.key}
          onClick={() => buyItem(it.key)}
          disabled={busy !== null || heat <= 0 || cash < it.price}
          className="px-3 py-2 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title={heat <= 0 ? 'No heat to reduce' : cash < it.price ? 'Not enough cash' : ''}
        >
          {it.emoji} {it.label} <span className="text-zinc-400">({it.desc})</span> —{' '}
          <span className="text-emerald-400">${it.price.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );

  // Compact "Lay Low" button used in the Safehouse.
  if (variant === 'laylow') {
    const layLow = HEAT_ITEMS.find((i) => i.key === 'lay_low')!;
    return (
      <div className="card p-4 mb-4 border border-zinc-700">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold">🕶️ Lay Low</h3>
            <p className="text-xs text-zinc-400">
              Hide out here to clear your heat.{' '}
              <span className={mostWanted ? 'text-red-400 font-semibold' : 'text-zinc-400'}>
                Current heat: {heat}/100{mostWanted ? ' — MOST WANTED' : ''}
              </span>
            </p>
          </div>
          <button
            onClick={() => buyItem('lay_low')}
            disabled={busy !== null || heat <= 0 || cash < layLow.price}
            className="px-4 py-2 rounded text-sm bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Lay Low (heat → 0) — ${layLow.price.toLocaleString()}
          </button>
        </div>
      </div>
    );
  }

  // Item-only block for the Street Dealer store.
  if (variant === 'store') {
    return (
      <div className="card p-4 mb-4 border border-zinc-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold">🌡️ Cool Down the Heat</h3>
          <span className={`text-xs font-mono ${mostWanted ? 'text-red-400' : 'text-zinc-400'}`}>
            🔥 {heat}/100{mostWanted ? ' · MOST WANTED' : ''}
          </span>
        </div>
        {itemButtons}
        <p className="text-[10px] text-zinc-500 mt-2">
          Heat also cools on its own over time while you lay off the crime.
        </p>
      </div>
    );
  }

  // Full panel for the Dashboard.
  return (
    <section className="card p-5 border border-zinc-700">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold flex items-center gap-2">🌡️ Heat</h2>
        {mostWanted ? (
          <span className="text-[11px] px-2 py-1 bg-red-600 text-white rounded font-bold tracking-wide animate-pulse">
            🚨 MOST WANTED
          </span>
        ) : (
          <span className="text-[11px] px-2 py-1 bg-zinc-800 text-zinc-300 rounded">
            {heat >= 40 ? 'Police watching' : heat > 0 ? 'Cooling down' : 'Clean'}
          </span>
        )}
      </div>

      {/* Heat bar */}
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
        <span>Heat level</span>
        <span className="font-mono">{heat}/100</span>
      </div>
      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
        <div className={`h-2.5 transition-all ${heatColor(heat)}`} style={{ width: `${heat}%` }} />
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        Heat passively cools while you stay off crimes
        {player.is_donator ? ' (donator: +50% faster)' : ''}
        {hasLawyer ? ' (corrupt lawyer: +50% faster)' : ''}. High heat raises your jail chance;
        at 75+ you become <span className="text-red-400 font-semibold">Most Wanted</span>.
      </p>

      {/* Reduction items */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-zinc-300 mb-2">Cool down now</div>
        {itemButtons}
      </div>

      {/* Corrupt lawyer upgrade */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="text-xs font-semibold text-zinc-300 mb-2">Permanent upgrade</div>
        {hasLawyer ? (
          <div className="text-sm text-emerald-400">⚖️ Corrupt Lawyer retained — heat cools 50% faster.</div>
        ) : (
          <button
            onClick={buyLawyer}
            disabled={busy !== null || cash < LAWYER_COST}
            className="px-4 py-2 rounded text-sm bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚖️ Retain a Corrupt Lawyer (+50% decay, permanent) — ${LAWYER_COST.toLocaleString()}
          </button>
        )}
      </div>
    </section>
  );
}
