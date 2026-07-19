'use client';
import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../../components/Panel';
import Card from '../../components/Card';
import BetInput from '../../components/BetInput';

type Deal = { hand_id: string; bet: number; cards: number[]; current: string; state: string };
type Draw = { cards: number[]; hand: string; multiplier: number; bet: number; payout: number; profit: number };

// 6/5 Jacks or Better paytable — must mirror _vp_multiplier in migration 080.
const PAYTABLE: Array<{ key: string; labelKey: TranslationKey; mult: number }> = [
  { key: 'royal_flush', labelKey: 'vp_royal_flush', mult: 250 },
  { key: 'straight_flush', labelKey: 'vp_straight_flush', mult: 50 },
  { key: 'four_kind', labelKey: 'vp_four_kind', mult: 25 },
  { key: 'full_house', labelKey: 'vp_full_house', mult: 6 },
  { key: 'flush', labelKey: 'vp_flush', mult: 5 },
  { key: 'straight', labelKey: 'vp_straight', mult: 4 },
  { key: 'three_kind', labelKey: 'vp_three_kind', mult: 3 },
  { key: 'two_pair', labelKey: 'vp_two_pair', mult: 2 },
  { key: 'jacks_better', labelKey: 'vp_jacks_better', mult: 1 },
];

export const dynamic = 'force-dynamic';

// Video Poker (080): jacks or better, 6/5 paytable. Deal, hold what you want,
// draw once. The undealt deck stays server-side.
export default function PokerPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [cards, setCards] = useState<number[] | null>(null);
  const [holds, setHolds] = useState<number[]>([]);
  const [phase, setPhase] = useState<'bet' | 'draw' | 'done'>('bet');
  const [result, setResult] = useState<Draw | null>(null);
  const [bet, setBet] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const resume = useCallback(async () => {
    const { data } = await supabase.rpc('get_casino_hand', { p_game: 'vpoker' });
    if (data?.active) {
      setCards(data.cards);
      setBet(data.bet);
      setPhase('draw');
    }
  }, [supabase]);

  useEffect(() => {
    if (player) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, resume]);

  const handleError = (m: string) => {
    if (m.includes('NOT_ENOUGH_CASH')) setError(t('common_not_enough_cash'));
    else if (m.includes('HAND_IN_PROGRESS')) setError(t('cas_hand_in_progress'));
    else if (m.includes('NO_ACTIVE_HAND')) setError(t('cas_no_hand'));
    else if (m.includes('IN_JAIL')) setError(t('error_in_jail'));
    else if (m.includes('INVALID_BET')) setError(t('cas_invalid_bet'));
    else setError(t('cas_failed'));
  };

  const deal = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    const { data, error: err } = await supabase.rpc('vp_deal', { p_bet: bet });
    setBusy(false);
    if (err) return handleError(err.message || '');
    const d = data as Deal;
    setCards(d.cards);
    setHolds([]);
    setPhase('draw');
    await refreshPlayer();
    await router.refresh();
  };

  const draw = async () => {
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('vp_draw', { p_holds: holds });
    setBusy(false);
    if (err) return handleError(err.message || '');
    const d = data as Draw;
    setCards(d.cards);
    setResult(d);
    setPhase('done');
    await refreshPlayer();
    await router.refresh();
  };

  const toggleHold = (i: number) => {
    if (phase !== 'draw') return;
    setHolds((h) => (h.includes(i + 1) ? h.filter((x) => x !== i + 1) : [...h, i + 1]));
  };

  if (!player) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🎴 {t('vp_title')}</h1>
          <p className="text-xs text-zinc-400">{t('vp_subtitle')}</p>
        </div>
        <Link href="/casino" className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-xs transition-all">🎰 {t('menu_casino_floor')}</Link>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800/50 rounded-xl px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* Paytable */}
      <Panel title={t('vp_paytable')} icon="📋" variant="premium" bodyClassName="p-0">
        {PAYTABLE.map((row) => (
          <div
            key={row.key}
            className={`flex items-center justify-between px-4 py-2 border-t first:border-t-0 border-zinc-800 text-xs ${
              result?.hand === row.key ? 'bg-amber-950/40 text-amber-300 font-semibold' : 'text-zinc-400'
            }`}
          >
            <span>{t(row.labelKey)}</span>
            <span className="font-mono text-amber-400 font-semibold">{row.mult}× — {fm(bet * row.mult)}</span>
          </div>
        ))}
      </Panel>

      {/* Hand */}
      <Panel title={t('vp_your_hand')} icon="🎴" variant="default">
        {!cards ? (
          <p className="text-sm text-zinc-500 py-8 text-center">{t('vp_place_bet')}</p>
        ) : (
          <>
            <div className="flex gap-3 justify-center mb-4 flex-wrap">
              {cards.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <Card n={c} selected={holds.includes(i + 1)} onClick={phase === 'draw' ? () => toggleHold(i) : undefined} />
                  <span className={`text-[9px] uppercase tracking-wider font-bold ${holds.includes(i + 1) ? 'text-amber-400' : 'text-zinc-700'}`}>
                    {holds.includes(i + 1) ? t('vp_held') : ' '}
                  </span>
                </div>
              ))}
            </div>
            {phase === 'draw' && <p className="text-[11px] text-zinc-500 text-center">{t('vp_tap_to_hold')}</p>}
          </>
        )}
      </Panel>

      {/* Result */}
      {phase === 'done' && result && (
        <div
          className={`border rounded-xl px-4 py-3 text-sm font-semibold ${
            result.payout > result.bet
              ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
              : result.payout === result.bet
                ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
                : 'bg-red-950/50 border-red-800 text-red-300'
          }`}
        >
          {result.multiplier > 0
            ? t('vp_result_win', {
                hand: t(PAYTABLE.find((p) => p.key === result.hand)?.labelKey ?? 'vp_jacks_better'),
                payout: fm(result.payout),
              })
            : t('vp_result_nothing')}
        </div>
      )}

      {/* Controls */}
      {phase === 'draw' ? (
        <button
          onClick={draw}
          disabled={busy}
          className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 rounded-xl font-bold text-sm disabled:opacity-50 transition-colors"
        >
          {busy ? t('vp_drawing') : t('vp_draw_button', { count: 5 - holds.length })}
        </button>
      ) : (
        <Panel title={t('cas_place_bet')} icon="💰" variant="premium">
          <BetInput bet={bet} setBet={setBet} disabled={busy} max={player.cash} />
          <button
            onClick={deal}
            disabled={busy || (player.cash ?? 0) < bet}
            className="w-full mt-3 py-3 bg-red-700 hover:bg-red-600 border border-red-600 rounded-xl font-bold text-sm disabled:opacity-50 transition-colors"
          >
            {busy ? t('cas_dealing') : t('vp_deal_button', { bet: fm(bet) })}
          </button>
        </Panel>
      )}

      <div className="text-[10px] text-zinc-600 text-center">{t('vp_rules')}</div>
    </div>
  );
}
