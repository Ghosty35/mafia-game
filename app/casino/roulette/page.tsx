'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';
import BetInput from '../../components/BetInput';

type Spin = {
  number: number;
  color: 'red' | 'black' | 'green';
  won: boolean;
  bet: number;
  bet_type: string;
  bet_value: number | null;
  payout: number;
  profit: number;
};

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const dynamic = 'force-dynamic';

// Roulette (079): a real single-zero wheel with authentic payouts — every bet
// type carries the same 2.70% house edge, which comes from the green zero.
export default function RoulettePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [bet, setBet] = useState(1000);
  const [betType, setBetType] = useState<string>('red');
  const [betValue, setBetValue] = useState<number | null>(null);
  const [last, setLast] = useState<Spin | null>(null);
  const [history, setHistory] = useState<Spin[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const spin = async () => {
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('roulette_spin', {
      p_bet_type: betType,
      p_bet_value: betValue,
      p_bet: bet,
    });
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('NOT_ENOUGH_CASH')) setError(t('common_not_enough_cash'));
      else if (m.includes('IN_JAIL')) setError(t('error_in_jail'));
      else if (m.includes('INVALID_BET_VALUE')) setError(t('rl_pick_number'));
      else if (m.includes('INVALID_BET')) setError(t('cas_invalid_bet'));
      else setError(t('cas_failed'));
      return;
    }
    const s = data as Spin;
    setLast(s);
    setHistory((h) => [s, ...h].slice(0, 12));
    await refreshPlayer();
    await router.refresh();
  };

  const outside: Array<{ key: string; label: string; pays: string }> = [
    { key: 'red', label: t('rl_red'), pays: '1:1' },
    { key: 'black', label: t('rl_black'), pays: '1:1' },
    { key: 'odd', label: t('rl_odd'), pays: '1:1' },
    { key: 'even', label: t('rl_even'), pays: '1:1' },
    { key: 'low', label: '1–18', pays: '1:1' },
    { key: 'high', label: '19–36', pays: '1:1' },
  ];

  const pick = (type: string, value: number | null = null) => {
    setBetType(type);
    setBetValue(value);
  };

  if (!player) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const needsNumber = betType === 'straight' && betValue == null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🎡 {t('rl_title')}</h1>
          <p className="text-xs text-zinc-400">{t('rl_subtitle')}</p>
        </div>
        <Link href="/casino" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">🎰 {t('menu_casino_floor')}</Link>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {/* Result */}
      {last && (
        <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center font-mono font-bold text-2xl shrink-0 ${
              last.color === 'green' ? 'bg-emerald-700' : last.color === 'red' ? 'bg-red-700' : 'bg-zinc-950 border border-zinc-600'
            }`}
          >
            {last.number}
          </div>
          <div className="min-w-0">
            <div className={`font-bold ${last.won ? 'text-emerald-400' : 'text-red-400'}`}>
              {last.won ? t('rl_won', { payout: fm(last.payout) }) : t('rl_lost', { bet: fm(last.bet) })}
            </div>
            <div className="text-xs text-zinc-500">{t('rl_landed', { color: t(`rl_${last.color}` as 'rl_red') })}</div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {history.map((h, i) => (
            <span
              key={i}
              className={`w-7 h-7 rounded flex items-center justify-center text-[11px] font-mono font-bold ${
                h.color === 'green' ? 'bg-emerald-800 text-white' : h.color === 'red' ? 'bg-red-800 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              {h.number}
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <Panel title={t('rl_pick_bet')} icon="🎡">
        {/* Numbers */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('rl_straight_up')} — 35:1</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
            <button
              onClick={() => pick('straight', 0)}
              className={`h-8 rounded text-xs font-mono font-bold border ${
                betType === 'straight' && betValue === 0
                  ? 'bg-emerald-600 border-emerald-400 text-white'
                  : 'bg-emerald-900/60 border-emerald-800 text-emerald-200 hover:border-emerald-500'
              }`}
            >
              0
            </button>
            {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => {
              const isSel = betType === 'straight' && betValue === n;
              return (
                <button
                  key={n}
                  onClick={() => pick('straight', n)}
                  className={`h-8 rounded text-xs font-mono font-bold border ${
                    isSel
                      ? 'bg-emerald-600 border-emerald-400 text-white'
                      : RED.has(n)
                        ? 'bg-red-900/60 border-red-800 text-red-200 hover:border-red-500'
                        : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dozens + columns */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('rl_dozens')} — 2:1</div>
            <div className="flex gap-1">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => pick('dozen', d)}
                  className={`flex-1 py-1.5 rounded text-[11px] font-semibold border ${
                    betType === 'dozen' && betValue === d
                      ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                      : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {(d - 1) * 12 + 1}–{d * 12}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('rl_columns')} — 2:1</div>
            <div className="flex gap-1">
              {[1, 2, 3].map((c) => (
                <button
                  key={c}
                  onClick={() => pick('column', c)}
                  className={`flex-1 py-1.5 rounded text-[11px] font-semibold border ${
                    betType === 'column' && betValue === c
                      ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                      : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {t('rl_col_n', { n: c })}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Outside */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('rl_outside')}</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
            {outside.map((o) => (
              <button
                key={o.key}
                onClick={() => pick(o.key)}
                className={`py-2 rounded text-[11px] font-semibold border ${
                  betType === o.key
                    ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                    : o.key === 'red'
                      ? 'bg-red-900/40 border-red-800 text-red-200 hover:border-red-500'
                      : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {/* Bet + spin */}
      <Panel title={t('cas_place_bet')} icon="💰">
        <div className="mb-3 text-xs text-zinc-400">
          {t('rl_betting_on')}{' '}
          <span className="text-white font-semibold">
            {betType === 'straight'
              ? t('rl_number_n', { n: betValue ?? '—' })
              : betType === 'dozen'
                ? `${((betValue ?? 1) - 1) * 12 + 1}–${(betValue ?? 1) * 12}`
                : betType === 'column'
                  ? t('rl_col_n', { n: betValue ?? 1 })
                  : outside.find((o) => o.key === betType)?.label}
          </span>
        </div>
        <BetInput bet={bet} setBet={setBet} disabled={busy} max={player.cash} />
        <button
          onClick={spin}
          disabled={busy || needsNumber || (player.cash ?? 0) < bet}
          className="w-full mt-3 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-bold text-sm disabled:opacity-50"
        >
          {busy ? t('rl_spinning') : t('rl_spin', { bet: fm(bet) })}
        </button>
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('rl_rules')}</div>
    </div>
  );
}
