'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type Channel = {
  key: string;
  min_level: number;
  fee_pct: number;
  daily_cap: number;
  used_24h: number;
  unlocked: boolean;
};

const CHANNEL_META: Record<string, { icon: string; labelKey: TranslationKey }> = {
  laundromat: { icon: '🧺', labelKey: 'ld_ch_laundromat' },
  casino: { icon: '🎰', labelKey: 'ld_ch_casino' },
  offshore: { icon: '🌴', labelKey: 'ld_ch_offshore' },
};

export default function LaunderingBoard() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, language } = useLanguage();
  const [dirty, setDirty] = useState<number>(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState('laundromat');
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const fmt = (n: number) =>
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_my_laundering');
    if (data) {
      setDirty(Number(data.dirty_cash ?? 0));
      setChannels((data.channels ?? []) as Channel[]);
    }
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, []);

  const ch = useMemo(() => channels.find((c) => c.key === selected), [channels, selected]);
  const capLeft = ch ? Math.max(0, ch.daily_cap - ch.used_24h) : 0;
  const maxWash = Math.min(dirty, capLeft);
  const receive = ch ? Math.max(0, amount - Math.floor(amount * ch.fee_pct)) : 0;

  const heat = player?.heat ?? 0;
  const hasLawyer = !!player?.has_corrupt_lawyer;
  const bustPct = Math.round((heat / 300) * (hasLawyer ? 0.5 : 1) * 100);

  const mapErr = (msg: string): string => {
    if (msg.includes('CAP_REACHED')) return t('ld_err_cap');
    if (msg.includes('NOT_ENOUGH_DIRTY_CASH')) return t('ld_err_dirty');
    if (msg.includes('LEVEL_TOO_LOW')) return t('ld_err_level');
    if (msg.includes('IN_JAIL')) return t('ld_err_jail');
    if (msg.includes('INVALID_AMOUNT')) return t('ld_err_amount');
    return msg;
  };

  const wash = async () => {
    if (busy || !ch) return;
    if (!amount || amount < 100) {
      showToast(t('ld_err_amount'), 'error');
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('launder_cash', {
        p_channel: ch.key,
        p_amount: Math.floor(amount),
      });
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      if (data?.busted) {
        showToast(t('ld_busted', { lost: `$${fmt(Number(data.lost))}` }), 'fail');
      } else {
        showToast(
          t('ld_success', {
            washed: `$${fmt(Number(data.washed))}`,
            cleaned: `$${fmt(Number(data.cleaned))}`,
            fee: `$${fmt(Number(data.fee))}`,
          }),
          'success',
        );
      }
      setAmount(0);
      await load();
      if (refreshPlayer) await refreshPlayer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 border border-red-900/60 bg-zinc-900">
          <div className="text-[11px] text-zinc-500">🩸 {t('ld_dirty_balance')}</div>
          <div className="font-mono text-xl text-red-400">${fmt(dirty)}</div>
        </div>
        <div className="card p-4 border border-zinc-700 bg-zinc-900">
          <div className="text-[11px] text-zinc-500">💵 {t('ld_clean_balance')}</div>
          <div className="font-mono text-xl text-emerald-400">${fmt(player?.cash ?? 0)}</div>
        </div>
      </div>

      {/* Channels */}
      <div className="grid md:grid-cols-3 gap-3">
        {channels.map((c) => {
          const meta = CHANNEL_META[c.key];
          const active = selected === c.key;
          const left = Math.max(0, c.daily_cap - c.used_24h);
          return (
            <button
              key={c.key}
              onClick={() => c.unlocked && setSelected(c.key)}
              disabled={!c.unlocked}
              className={`card p-4 text-left border transition ${
                active ? 'border-red-600 bg-red-950/20' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
              } ${!c.unlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="font-bold mb-1">
                {meta?.icon} {meta ? t(meta.labelKey) : c.key}
                {active && <span className="text-red-400"> ✓</span>}
              </div>
              <div className="text-xs text-zinc-400">
                {t('ld_fee')}: <span className="text-amber-400 font-mono">{Math.round(c.fee_pct * 100)}%</span>
              </div>
              <div className="text-xs text-zinc-400">
                {t('ld_cap_24h')}: <span className="font-mono">${fmt(left)}</span>{' '}
                <span className="text-zinc-600">(${fmt(c.used_24h)} {t('ld_used')})</span>
              </div>
              {!c.unlocked && (
                <div className="text-[10px] text-orange-400 mt-1">{t('ld_unlock_level', { level: c.min_level })}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Wash form */}
      <div className="card p-5 border border-zinc-700 bg-zinc-900 space-y-3">
        <label className="block text-sm">
          <span className="text-zinc-400 text-xs">{t('ld_amount')}</span>
          <div className="flex gap-2 mt-1">
            <input
              type="number"
              min={100}
              max={maxWash}
              value={amount || ''}
              onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 font-mono"
            />
            <button
              onClick={() => setAmount(maxWash)}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs"
            >
              {t('ld_max')} (${fmt(maxWash)})
            </button>
          </div>
        </label>

        <div className="text-xs text-zinc-400 space-y-0.5">
          <div>{t('ld_you_receive', { amount: `$${fmt(receive)}` })}</div>
          <div className={bustPct > 10 ? 'text-orange-400' : ''}>
            {t('ld_bust_risk', { pct: bustPct, lawyer: hasLawyer ? t('ld_bust_lawyer') : '' })}
          </div>
        </div>

        <button
          onClick={wash}
          disabled={busy || !ch || !ch.unlocked || amount < 100 || amount > maxWash}
          className="w-full py-2.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed rounded font-semibold"
        >
          🧼 {t('ld_wash')}
        </button>

        <p className="text-[10px] text-zinc-500">{t('ld_note')}</p>
      </div>
    </div>
  );
}
