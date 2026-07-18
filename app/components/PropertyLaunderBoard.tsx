'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import type { OwnedProperty } from '@/lib/types';

// Mirror of public._property_launder_tier in 095_property_laundering.sql.
// Kept in sync for display/validation only; the server is authoritative.
type Tier = { feePct: number; capacity: number; washSeconds: number };
const tierFor = (ptype?: string): Tier => {
  switch ((ptype || '').toLowerCase()) {
    case 'mansion': return { feePct: 0.10, capacity: 25_000_000, washSeconds: 21600 };
    case 'villa':   return { feePct: 0.13, capacity: 12_000_000, washSeconds: 18000 };
    case 'house':   return { feePct: 0.16, capacity: 5_000_000, washSeconds: 14400 };
    default:        return { feePct: 0.18, capacity: 8_000_000, washSeconds: 14400 };
  }
};

const PTYPE_ICON: Record<string, string> = {
  mansion: '💎', villa: '🏛️', house: '🏠', agency: '🏢',
  airport: '✈️', casino: '🎰', tuneshop: '🔧', redlight: '🌃',
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(iv);
  }, [intervalMs]);
  return now;
}

const fmtDuration = (secs: number) => {
  if (secs <= 0) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
};

export default function PropertyLaunderBoard() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const now = useNow();
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const dirty = Number(player?.dirty_cash ?? 0);
  const owned: OwnedProperty[] = useMemo(() => player?.owned_properties ?? [], [player]);

  const mapErr = (msg: string): string => {
    if (msg.includes('BATCH_ACTIVE')) return t('pl_err_active');
    if (msg.includes('OVER_CAPACITY')) return t('pl_err_capacity');
    if (msg.includes('NOT_ENOUGH_DIRTY_CASH')) return t('ld_err_dirty');
    if (msg.includes('NOT_READY')) return t('pl_err_not_ready');
    if (msg.includes('NO_BATCH')) return t('pl_err_no_batch');
    if (msg.includes('IN_JAIL')) return t('ld_err_jail');
    if (msg.includes('INVALID_AMOUNT')) return t('ld_err_amount');
    return msg;
  };

  const pump = async (prop: OwnedProperty) => {
    const amount = Math.floor(amounts[prop.id] ?? 0);
    if (busy || amount < 100) {
      showToast(t('ld_err_amount'), 'error');
      return;
    }
    setBusy(prop.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('launder_via_property', {
        p_prop_id: prop.id,
        p_amount: amount,
      });
      if (error) { showToast(mapErr(error.message), 'error'); return; }
      showToast(t('pl_started', { amount: fm(amount), name: prop.name }), 'success');
      setAmounts((prev) => ({ ...prev, [prop.id]: 0 }));
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const collect = async (prop: OwnedProperty) => {
    if (busy) return;
    setBusy(prop.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('collect_property_launder', {
        p_prop_id: prop.id,
      });
      if (error) { showToast(mapErr(error.message), 'error'); return; }
      if (data?.busted) {
        showToast(t('ld_busted', { lost: fm(Number(data.lost)) }), 'fail');
      } else {
        showToast(t('ld_success', {
          washed: fm(Number(data.washed)),
          cleaned: fm(Number(data.cleaned)),
          fee: fm(Number(data.fee)),
        }), 'success');
      }
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!player) return null;

  return (
    <div className="card p-5 border border-zinc-700 bg-zinc-900 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">🏠 {t('pl_title')}</h2>
        <p className="text-[11px] text-zinc-500">{t('pl_desc')}</p>
      </div>

      {owned.length === 0 ? (
        <p className="text-xs text-zinc-500">{t('pl_none')}</p>
      ) : (
        <div className="space-y-2">
          {owned.map((prop) => {
            const tier = tierFor(prop.ptype);
            const pending = Number(prop.launder_pending ?? 0);
            const fee = Number(prop.launder_fee ?? 0);
            const readyAt = prop.launder_ready_at ? new Date(prop.launder_ready_at).getTime() : 0;
            const secsLeft = pending > 0 ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;
            const ready = pending > 0 && secsLeft <= 0;
            const maxIn = Math.min(dirty, tier.capacity);
            const amt = amounts[prop.id] ?? 0;
            const receive = Math.max(0, amt - Math.floor(amt * tier.feePct));

            return (
              <div key={prop.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm">
                    {PTYPE_ICON[(prop.ptype || '').toLowerCase()] || '🏢'} {prop.name}
                    <span className="text-[10px] text-zinc-500 ml-1">• {prop.city}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 text-right">
                    {t('pl_fee')} {Math.round(tier.feePct * 100)}% • {fmtDuration(tier.washSeconds)}
                  </div>
                </div>

                {pending > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        {t('pl_washing', { amount: fm(pending) })}
                        <span className="text-zinc-600"> (−{fm(fee)} {t('pl_fee').toLowerCase()})</span>
                      </span>
                      <span className={`font-mono ${ready ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {ready ? t('pl_ready') : fmtDuration(secsLeft)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{
                          width: `${prop.launder_started_at
                            ? Math.min(100, 100 * (1 - secsLeft / Math.max(1, tier.washSeconds)))
                            : ready ? 100 : 0}%`,
                        }}
                      />
                    </div>
                    <button
                      onClick={() => collect(prop)}
                      disabled={!ready || busy === prop.id}
                      className="w-full py-2 rounded text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      💵 {ready ? t('pl_collect', { amount: fm(pending - fee) }) : t('pl_collect_wait')}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={100}
                        max={maxIn}
                        value={amt || ''}
                        onChange={(e) =>
                          setAmounts((prev) => ({
                            ...prev,
                            [prop.id]: Math.max(0, Math.min(maxIn, parseInt(e.target.value) || 0)),
                          }))
                        }
                        placeholder={t('pl_amount_ph')}
                        className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 font-mono text-sm"
                      />
                      <button
                        onClick={() => setAmounts((prev) => ({ ...prev, [prop.id]: maxIn }))}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs shrink-0"
                      >
                        {t('ld_max')}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>{t('pl_capacity', { amount: fm(tier.capacity) })}</span>
                      {amt >= 100 && <span className="text-emerald-400">{t('pl_you_receive', { amount: fm(receive) })}</span>}
                    </div>
                    <button
                      onClick={() => pump(prop)}
                      disabled={busy === prop.id || amt < 100 || amt > maxIn}
                      className="w-full py-2 rounded text-xs font-semibold bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      🧼 {t('pl_pump')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
