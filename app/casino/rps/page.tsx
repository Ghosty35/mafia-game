'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';
import BetInput from '../../components/BetInput';

type Result = {
  result: 'win' | 'lose' | 'draw';
  choice: string;
  house: string;
  bet: number;
  payout: number;
  profit: number;
};

const HANDS: Array<{ key: string; emoji: string }> = [
  { key: 'rock', emoji: '✊' },
  { key: 'paper', emoji: '✋' },
  { key: 'scissors', emoji: '✌️' },
];

export const dynamic = 'force-dynamic';

// Rock / Paper / Scissors (079): fair 1/3 odds, the house picks blind. A win
// pays 1.9x rather than 2x — that 0.1 is the entire house edge (3.33%).
export default function RpsPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [bet, setBet] = useState(1000);
  const [last, setLast] = useState<Result | null>(null);
  const [streak, setStreak] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const play = async (choice: string) => {
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('rps_play', { p_choice: choice, p_bet: bet });
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('NOT_ENOUGH_CASH')) setError(t('common_not_enough_cash'));
      else if (m.includes('IN_JAIL')) setError(t('error_in_jail'));
      else if (m.includes('INVALID_BET')) setError(t('cas_invalid_bet'));
      else setError(t('cas_failed'));
      return;
    }
    const r = data as Result;
    setLast(r);
    setStreak((s) => [r, ...s].slice(0, 10));
    await refreshPlayer();
    await router.refresh();
  };

  const emojiFor = (key: string) => HANDS.find((h) => h.key === key)?.emoji ?? '?';

  if (!player) return <div className="max-w-2xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const tone =
    last?.result === 'win'
      ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
      : last?.result === 'draw'
        ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
        : 'bg-red-950/50 border-red-800 text-red-300';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">✊ {t('rps_title')}</h1>
          <p className="text-xs text-zinc-400">{t('rps_subtitle')}</p>
        </div>
        <Link href="/casino" className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs transition-all">🎰 {t('menu_casino_floor')}</Link>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800/50 rounded-xl px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* Showdown */}
      {last && (
        <div className={`border rounded-xl px-4 py-5 ${tone}`}>
          <div className="flex items-center justify-center gap-6 mb-3">
            <div className="text-center">
              <div className="text-5xl">{emojiFor(last.choice)}</div>
              <div className="text-[10px] uppercase tracking-[3px] mt-2 opacity-70">{t('rps_you')}</div>
            </div>
            <div className="text-2xl font-bold opacity-50">VS</div>
            <div className="text-center">
              <div className="text-5xl">{emojiFor(last.house)}</div>
              <div className="text-[10px] uppercase tracking-[3px] mt-2 opacity-70">{t('rps_house')}</div>
            </div>
          </div>
          <div className="text-center text-sm font-semibold">
            {last.result === 'win'
              ? t('rps_win', { payout: fm(last.payout) })
              : last.result === 'draw'
                ? t('rps_draw')
                : t('rps_lose', { bet: fm(last.bet) })}
          </div>
        </div>
      )}

      {/* Streak */}
      {streak.length > 0 && (
        <div className="flex gap-1.5 justify-center">
          {streak.map((s, i) => (
            <span
              key={i}
              title={`${s.choice} vs ${s.house}`}
              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold border ${
                s.result === 'win' ? 'bg-emerald-800 text-white border-emerald-600' : s.result === 'draw' ? 'bg-zinc-700 text-zinc-300 border-zinc-600' : 'bg-red-900 text-red-200 border-red-800'
              }`}
            >
              {s.result === 'win' ? 'W' : s.result === 'draw' ? 'D' : 'L'}
            </span>
          ))}
        </div>
      )}

      {/* Bet */}
      <Panel title={t('cas_place_bet')} icon="💰" variant="premium">
        <BetInput bet={bet} setBet={setBet} disabled={busy} max={player.cash} />
      </Panel>

      {/* Throw */}
      <Panel title={t('rps_throw')} icon="✊" variant="default">
        <div className="grid grid-cols-3 gap-3">
          {HANDS.map((h) => (
            <button
              key={h.key}
              onClick={() => play(h.key)}
              disabled={busy || (player.cash ?? 0) < bet}
              className="py-6 bg-zinc-950 border border-zinc-800 hover:border-amber-700/50 rounded-xl disabled:opacity-40 transition-all hover:shadow-[0_0_15px_rgba(245,158,11,0.06)]"
            >
              <div className="text-5xl mb-2">{h.emoji}</div>
              <div className="text-xs font-semibold text-zinc-300">{t(`rps_${h.key}` as 'rps_rock')}</div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="text-[10px] text-zinc-600 text-center">{t('rps_rules')}</div>
    </div>
  );
}
