'use client';
import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';

type LotteryInfo = {
  ticket_cost: number;
  win_chance: number;
  is_donator: boolean;
  pool: number;
  pool_active: boolean;
  jackpot_prize: number | null;
  base_prize_min: number;
  base_prize_max: number;
  can_enter: boolean;
  next_entry_at: string | null;
  my_cash: number;
};

export const dynamic = 'force-dynamic';

// Weekly lottery (real, per 084): $5,000 a ticket, one entry per 7 days, real
// 37/42% odds, and a live pool that pays 8% once it clears $200k. The old page
// invented a Friday-draw countdown and a fake ticket count and showed none of
// the actual numbers.
export default function LotteryPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [info, setInfo] = useState<LotteryInfo | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_lottery_info');
    if (data) setInfo(data as LotteryInfo);
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  // Drives the cooldown countdown.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const enter = async () => {
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('enter_weekly_lottery');
    setBusy(false);
    if (error) {
      const m = error.message || '';
      if (m.includes('LOTTERY_ON_COOLDOWN')) setMessage(t('lot_err_cooldown'));
      else if (m.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else setMessage(t('lottery_entry_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer(); await router.refresh();
    await load();
    setMessage(data?.won ? t('lot_won', { prize: fm(data.prize || 0) }) : t('lot_lost', { cost: fm(data?.ticket_cost || 5000) }));
  };

  if (!player || !info) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const cooldownLeft = info.next_entry_at ? Math.max(0, new Date(info.next_entry_at).getTime() - now) : 0;
  const cdText = () => {
    const s = Math.floor(cooldownLeft / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🎟️ {t('lottery_title')}</h1>
          <p className="text-xs text-zinc-400">{t('lot_subtitle')}</p>
        </div>
        <Link href="/casino" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">🎰 {t('menu_casino_floor')}</Link>
      </div>

      {message && <div className="bg-zinc-900 border border-yellow-700/60 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* Pool + odds */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-amber-900/50 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lot_pool')}</div>
          <div className="font-mono font-bold text-2xl text-amber-400 tabular-nums">{fm(info.pool)}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {info.pool_active ? t('lot_pool_active') : t('lot_pool_building', { threshold: fm(200000) })}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lot_your_odds')}</div>
          <div className="font-mono font-bold text-2xl text-emerald-400 tabular-nums">{info.win_chance}%</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {info.is_donator ? t('lot_donator_odds') : t('lot_regular_odds')}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lot_prize')}</div>
          <div className="font-mono font-bold text-2xl text-white tabular-nums">
            {info.jackpot_prize != null ? fm(info.jackpot_prize) : `${fm(info.base_prize_min)}+`}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {info.jackpot_prize != null ? t('lot_prize_jackpot') : t('lot_prize_range', { min: fm(info.base_prize_min), max: fm(info.base_prize_max) })}
          </div>
        </div>
      </div>

      {/* Play */}
      <Panel title={t('lot_play_title')} icon="🎟️">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-zinc-300">
            {t('lot_ticket_cost', { cost: fm(info.ticket_cost) })}
          </div>
          {info.can_enter ? (
            <button
              onClick={enter}
              disabled={busy || info.my_cash < info.ticket_cost}
              className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black rounded-lg text-sm font-bold disabled:opacity-50"
            >
              {busy ? t('lot_entering') : t('lot_buy_ticket', { cost: fm(info.ticket_cost) })}
            </button>
          ) : (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('lot_next_entry')}</div>
              <div className="font-mono text-amber-400">{cdText()}</div>
            </div>
          )}
        </div>
        {info.my_cash < info.ticket_cost && info.can_enter && (
          <p className="text-[11px] text-red-400 mt-2">{t('common_not_enough_cash')}</p>
        )}
      </Panel>

      {/* How it works — real rules */}
      <Panel title={t('lot_how_title')} icon="ℹ️">
        <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
          <li>{t('lot_how_1', { cost: fm(info.ticket_cost) })}</li>
          <li>{t('lot_how_2')}</li>
          <li>{t('lot_how_3', { threshold: fm(200000) })}</li>
          <li>{t('lot_how_4')}</li>
        </ul>
      </Panel>
    </div>
  );
}
