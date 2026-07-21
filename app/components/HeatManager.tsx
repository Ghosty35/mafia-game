'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { useEconomy } from '@/lib/economy';
import { useRouter } from 'next/navigation';

type Variant = 'full' | 'store' | 'laylow';

function heatColor(heat: number) {
  if (heat >= 75) return 'bg-red-600';
  if (heat >= 40) return 'bg-orange-500';
  if (heat >= 20) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

export default function HeatManager({ variant = 'full' }: { variant?: Variant }) {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const economy = useEconomy();

  if (!player) return null;

  const heat = player.heat ?? 0;
  const mostWanted = heat >= 75;
  const hasLawyer = !!player.has_corrupt_lawyer;
  const cash = player.cash ?? 0;

  // Live catalog from the server (fallback to last-known constants if the RPC
  // hasn't resolved yet, so buttons still render). Mirrors migration 062.
  const HEAT_ITEMS = (economy?.heat_items ?? [
    { key: 'burner', price: 5000, drop: 20, zero: false },
    { key: 'bribe', price: 25000, drop: 50, zero: false },
    { key: 'lay_low', price: 60000, drop: 0, zero: true },
  ]).map((it) => {
    const labelKey: TranslationKey =
      it.key === 'burner' ? 'hm_item_burner' : it.key === 'bribe' ? 'hm_item_bribe' : 'hm_item_lay_low';
    const desc =
      it.key === 'burner' ? '−20 heat' : it.key === 'bribe' ? '−50 heat' : 'heat → 0';
    const emoji = it.key === 'burner' ? '📱' : it.key === 'bribe' ? '🤝' : '🕶️';
    return { key: it.key, labelKey, emoji, desc, price: it.price };
  });
  const LAWYER_COST = economy?.lawyer_cost ?? 250000;

  const mapErr = (msg: string) =>
    msg.includes('NO_HEAT')
      ? t('hm_err_no_heat')
      : msg.includes('NOT_ENOUGH_CASH')
        ? t('hm_err_no_cash')
        : msg.includes('ALREADY_OWNED')
          ? t('hm_err_already_lawyer')
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
      showToast(t('hm_toast_item', { label: data.label, heat: data.new_heat }), 'success');
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const buyLawyer = async () => {
    if (busy) return;
    setBusy('lawyer');
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('buy_corrupt_lawyer');
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      showToast(t('hm_toast_lawyer'), 'success');
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
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
        >
          {it.emoji} {t(it.labelKey)} <span className="text-zinc-400">({it.desc})</span> —{' '}
          <span className="text-emerald-400">{fm(it.price)}</span>
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
            <h3 className="font-bold">🕶️ {t('hm_item_lay_low')}</h3>
            <p className="text-xs text-zinc-400">
              {t('hm_lay_low_desc')}{' '}
              <span className={mostWanted ? 'text-red-400 font-semibold' : 'text-zinc-400'}>
                {t('hm_current_heat', { heat })}{mostWanted ? ` — ${t('pi_most_wanted')}` : ''}
              </span>
            </p>
          </div>
          <button
            onClick={() => buyItem('lay_low')}
            disabled={busy !== null || heat <= 0 || cash < layLow.price}
            className="px-4 py-2 rounded text-sm bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('hm_item_lay_low')} (heat → 0) — ${layLow.price.toLocaleString()}
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
          <h3 className="font-bold">🌡️ {t('hm_store_title')}</h3>
          <span className={`text-xs font-mono ${mostWanted ? 'text-red-400' : 'text-zinc-400'}`}>
            🔥 {heat}/100{mostWanted ? ` · ${t('pi_most_wanted')}` : ''}
          </span>
        </div>
        {itemButtons}
        <p className="text-[10px] text-zinc-500 mt-2">{t('hm_store_note')}</p>
      </div>
    );
  }

  // Full panel for the Dashboard.
  return (
    <section className="card p-5 border border-zinc-700">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold flex items-center gap-2">🌡️ {t('hm_title')}</h2>
        {mostWanted ? (
          <span className="text-[11px] px-2 py-1 bg-red-600 text-white rounded font-bold tracking-wide animate-pulse">
            🚨 {t('pi_most_wanted')}
          </span>
        ) : (
          <span className="text-[11px] px-2 py-1 bg-zinc-800 text-zinc-300 rounded">
            {heat >= 40 ? t('hm_police_watching') : heat > 0 ? t('hm_cooling') : t('hm_clean')}
          </span>
        )}
      </div>

      {/* Heat bar */}
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
        <span>{t('hm_heat_level')}</span>
        <span className="font-mono">{heat}/100</span>
      </div>
      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
        <div className={`h-2.5 transition-all ${heatColor(heat)}`} style={{ width: `${heat}%` }} />
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        {t('hm_decay_note')}
        {player.is_donator ? ` (${t('hm_donator_perk')})` : ''}
        {hasLawyer ? ` (${t('hm_lawyer_perk')})` : ''}
      </p>

      {/* Reduction items */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-zinc-300 mb-2">{t('hm_cool_now')}</div>
        {itemButtons}
      </div>

      {/* Corrupt lawyer upgrade */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="text-xs font-semibold text-zinc-300 mb-2">{t('hm_perm_upgrade')}</div>
        {hasLawyer ? (
          <div className="text-sm text-emerald-400">⚖️ {t('hm_lawyer_owned')}</div>
        ) : (
          <button
            onClick={buyLawyer}
            disabled={busy !== null || cash < LAWYER_COST}
            className="px-4 py-2 rounded text-sm bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚖️ {t('hm_lawyer_buy')} — ${LAWYER_COST.toLocaleString()}
          </button>
        )}
      </div>
    </section>
  );
}
