'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';
import Card from '../../components/Card';
import BetInput from '../../components/BetInput';

type Hand = {
  hand_id: string;
  bet: number;
  player_cards: number[];
  player_value: number;
  dealer_cards: number[];
  dealer_value: number | null;
  state: 'active' | 'done';
  result: string | null;
  payout: number;
  profit?: number;
};

export const dynamic = 'force-dynamic';

// Blackjack (080): the deck lives server-side, so the client only ever sees
// its own cards and the dealer's up-card. Dealer stands on all 17, naturals
// pay 3:2, no double or split.
export default function BlackjackPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();

  const [hand, setHand] = useState<Hand | null>(null);
  const [bet, setBet] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  // Pick up a hand left open by a refresh.
  const resume = useCallback(async () => {
    const { data } = await supabase.rpc('get_casino_hand', { p_game: 'blackjack' });
    if (data?.active) {
      setHand({
        hand_id: data.hand_id,
        bet: data.bet,
        player_cards: data.player_cards,
        player_value: data.player_value,
        dealer_cards: data.dealer_cards,
        dealer_value: null,
        state: 'active',
        result: null,
        payout: 0,
      });
    }
  }, []);

  useEffect(() => {
    if (player) resume();
  }, [player?.id, resume]);

  const run = async (fn: string, args?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc(fn, args ?? {});
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('NOT_ENOUGH_CASH')) setError(t('common_not_enough_cash'));
      else if (m.includes('HAND_IN_PROGRESS')) setError(t('cas_hand_in_progress'));
      else if (m.includes('NO_ACTIVE_HAND')) setError(t('cas_no_hand'));
      else if (m.includes('IN_JAIL')) setError(t('error_in_jail'));
      else if (m.includes('INVALID_BET')) setError(t('cas_invalid_bet'));
      else setError(t('cas_failed'));
      return null;
    }
    setHand(data as Hand);
    await refreshPlayer();
    return data;
  };

  const active = hand?.state === 'active';
  const done = hand?.state === 'done';

  const resultText = () => {
    if (!hand?.result) return null;
    switch (hand.result) {
      case 'blackjack': return t('bj_natural', { payout: fm(hand.payout) });
      case 'win': return t('bj_win', { payout: fm(hand.payout) });
      case 'push': return t('bj_push');
      case 'bust': return t('bj_bust');
      case 'lose': return t('bj_lose');
      default: return null;
    }
  };

  const resultTone = () =>
    hand?.result === 'win' || hand?.result === 'blackjack'
      ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
      : hand?.result === 'push'
        ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
        : 'bg-red-950/50 border-red-800 text-red-300';

  if (!player) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🃏 {t('bj_title')}</h1>
          <p className="text-xs text-zinc-400">{t('bj_subtitle')}</p>
        </div>
        <Link href="/casino" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">🎰 {t('menu_casino_floor')}</Link>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {/* Table */}
      <Panel title={t('bj_table')} icon="🃏">
        {!hand ? (
          <p className="text-sm text-zinc-500 py-6 text-center">{t('bj_place_bet')}</p>
        ) : (
          <div className="space-y-4">
            {/* Dealer */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{t('bj_dealer')}</span>
                <span className="font-mono text-sm text-zinc-300">
                  {hand.dealer_value ?? '?'}
                </span>
              </div>
              <div className="flex gap-1.5">
                {hand.dealer_cards.map((c, i) => <Card key={i} n={c} />)}
                {active && <Card faceDown />}
              </div>
            </div>

            <div className="border-t border-zinc-800" />

            {/* Player */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{t('bj_you')}</span>
                <span className={`font-mono text-sm ${hand.player_value > 21 ? 'text-red-400' : 'text-white'}`}>
                  {hand.player_value}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {hand.player_cards.map((c, i) => <Card key={i} n={c} />)}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Result */}
      {done && resultText() && (
        <div className={`border rounded-xl px-4 py-3 text-sm font-semibold ${resultTone()}`}>{resultText()}</div>
      )}

      {/* Controls */}
      {active ? (
        <div className="flex gap-2">
          <button
            onClick={() => run('bj_hit')}
            disabled={busy}
            className="flex-1 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {t('bj_hit')}
          </button>
          <button
            onClick={() => run('bj_stand')}
            disabled={busy}
            className="flex-1 py-3 bg-emerald-700 hover:bg-emerald-600 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {t('bj_stand')}
          </button>
        </div>
      ) : (
        <Panel title={t('cas_place_bet')} icon="💰">
          <BetInput bet={bet} setBet={setBet} disabled={busy} max={player.cash} />
          <button
            onClick={() => run('bj_deal', { p_bet: bet })}
            disabled={busy || (player.cash ?? 0) < bet}
            className="w-full mt-3 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {busy ? t('cas_dealing') : t('bj_deal_button', { bet: fm(bet) })}
          </button>
        </Panel>
      )}

      <div className="text-[11px] text-zinc-500">{t('bj_rules')}</div>
    </div>
  );
}
