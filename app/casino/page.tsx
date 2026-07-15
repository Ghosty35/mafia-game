'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { formatCash } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';

type CasinoPools = {
  blackjack: number;
  roulette: number;
  lottery: number;
  general: number;
};

type CasinoPlayResult = {
  won: boolean;
  payout: number;
  player: Player;
};

type LastResult = {
  game: string;
  won: boolean;
  bet: number;
  payout?: number;
  net?: number;
  spin?: number;
  choice?: string;
};

export default function CasinoPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const { t, language } = useLanguage();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState(5000);
  const [pools, setPools] = useState<CasinoPools>({
    blackjack: 1250000,
    roulette: 890000,
    lottery: 2450000,
    general: 560000,
  });
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  // Live pool fetch (from new RPC or fallback)
  const fetchPools = async () => {
    const supabase = createClient();
    try {
      const { data } = await supabase.rpc('get_casino_pools');
      if (data) setPools(data as CasinoPools);
    } catch {
      // fallback demo numbers grow slowly with play
    }
  };

  useEffect(() => {
    fetchPools();
  }, []);

  const playGame = async (game: 'blackjack' | 'roulette') => {
    if (!player) return;
    if (bet < 100 || bet > 200000) {
      setMessage(t('casino_bet_range'));
      return;
    }
    if (player.cash < bet) {
      setMessage(t('common_not_enough_cash'));
      return;
    }

    setBusy(true);
    setMessage('');
    const supabase = createClient();

    try {
      const { data, error } = await supabase.rpc('play_casino', { game, bet });
      if (error) throw error;

      const res = data as CasinoPlayResult;
      updatePlayer(res.player);
      await refreshPlayer();

      const won = res.won;
      const net = won ? res.payout - bet : -bet;
      setLastResult({ game, won, bet, payout: res.payout, net });

      setMessage(
        won
          ? t('casino_win_msg', {
              game: game.toUpperCase(),
              net: `$${(res.payout - bet).toLocaleString()}`,
              payout: `$${res.payout.toLocaleString()}`,
            })
          : t('casino_lose_msg', { bet: `$${bet.toLocaleString()}`, game }),
      );

      // Refresh pools
      await fetchPools();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t('casino_play_failed'));
    }
    setBusy(false);
  };

  // Roulette specific: choose bet type for extra fun
  const [rouletteChoice, setRouletteChoice] = useState<'red' | 'black' | 'number'>('red');
  const [rouletteNumber, setRouletteNumber] = useState(7);

  const playRoulette = async () => {
    if (!player) return;
    if (player.cash < bet) {
      setMessage(t('common_not_enough_cash'));
      return;
    }
    setBusy(true);

    const supabase = createClient();
    try {
      const { data, error } = await supabase.rpc('play_casino', { game: 'roulette', bet });
      if (error) throw error;

      const res = data as CasinoPlayResult;
      updatePlayer(res.player);
      await refreshPlayer();

      // Visual roulette result (client side for show)
      const spin = Math.floor(Math.random() * 37);
      const won = res.won;

      setLastResult({ game: 'roulette', won, bet, spin, choice: rouletteChoice });
      setMessage(
        won
          ? t('casino_roulette_win', { spin })
          : t('casino_roulette_lose', { spin, bet: `$${bet.toLocaleString()}` }),
      );

      await fetchPools();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t('casino_play_failed'));
    }
    setBusy(false);
  };

  const currentBetOptions = [1000, 5000, 10000, 25000, 50000, 100000];

  const poolCards = [
    { label: t('casino_pool_blackjack'), val: pools.blackjack, icon: '♠️' },
    { label: t('casino_pool_roulette'), val: pools.roulette, icon: '🎡' },
    { label: t('casino_pool_lottery'), val: pools.lottery, icon: '🎟️' },
    { label: t('casino_pool_general'), val: pools.general, icon: '💰' },
  ];

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">🎰 {t('casino_title')}</h1>
          <p className="text-zinc-400">{t('casino_desc')}</p>
        </div>
        <Link href="/casino/lottery" className="text-red-400 hover:underline font-semibold shrink-0">
          {t('casino_weekly_lottery')}
        </Link>
      </div>

      {lastResult && (
        <div
          className={`mb-5 p-4 rounded-xl border ${
            lastResult.won ? 'border-green-700 bg-green-950/40' : 'border-red-800 bg-red-950/30'
          }`}
        >
          <div className="font-semibold">{lastResult.won ? t('casino_winner') : t('casino_house_wins')}</div>
          <div className="text-sm mt-1">
            {lastResult.game} • {t('casino_result_bet', { bet: `$${lastResult.bet?.toLocaleString()}` })}
            {lastResult.payout
              ? ` • ${t('casino_result_paid', { payout: `$${lastResult.payout.toLocaleString()}` })}`
              : ''}
            {lastResult.spin !== undefined && ` • ${t('casino_result_landed', { spin: lastResult.spin })}`}
          </div>
        </div>
      )}

      {message && <div className="mb-5 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>}

      {/* Live Pools - attracts gamblers */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {poolCards.map((p, i) => (
          <div key={i} className="card p-4 bg-zinc-950 border border-amber-900/50">
            <div className="text-xs text-amber-400">
              {p.icon} {p.label}
            </div>
            <div className="text-2xl font-mono text-emerald-400 mt-1">{formatCash(p.val, language)}</div>
            <div className="text-[10px] text-zinc-500">{t('casino_pool_note')}</div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="text-sm mb-2">{t('casino_choose_wager')}</div>
        <div className="flex flex-wrap gap-2">
          {currentBetOptions.map((b) => (
            <button
              key={b}
              onClick={() => setBet(b)}
              className={`px-4 py-1 rounded text-sm border ${
                bet === b ? 'bg-red-700 border-red-500' : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500'
              }`}
            >
              ${b.toLocaleString()}
            </button>
          ))}
          <input
            type="number"
            value={bet}
            onChange={(e) => setBet(Math.max(100, Math.min(200000, parseInt(e.target.value) || 1000)))}
            className="bg-zinc-950 border border-zinc-700 px-3 py-1 w-28 rounded text-sm"
          />
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          {t('casino_your_cash')}{' '}
          <span className="text-emerald-400 font-mono">{player ? formatCash(player.cash, language) : '$0'}</span> •{' '}
          {t('casino_house_edge_note')}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* BLACKJACK - Fully working */}
        <div className="card p-6 border border-red-900/60">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-4xl">♠️</div>
            <div>
              <div className="font-bold text-xl">{t('casino_blackjack')}</div>
              <div className="text-xs text-zinc-400">{t('casino_blackjack_desc')}</div>
            </div>
          </div>

          <button
            onClick={() => playGame('blackjack')}
            disabled={busy || !player}
            className="w-full py-3 bg-gradient-to-r from-red-700 to-red-600 hover:from-red-600 rounded-xl font-bold text-lg disabled:opacity-60"
          >
            {busy ? t('casino_dealing') : t('casino_deal_button', { bet: `$${bet.toLocaleString()}` })}
          </button>

          <p className="text-[10px] text-zinc-500 mt-2">{t('casino_blackjack_note')}</p>
        </div>

        {/* ROULETTE - Fully working */}
        <div className="card p-6 border border-amber-900/60">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-4xl">🎡</div>
            <div>
              <div className="font-bold text-xl">{t('casino_roulette')}</div>
              <div className="text-xs text-zinc-400">{t('casino_roulette_desc')}</div>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            {(['red', 'black', 'number'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setRouletteChoice(c)}
                className={`px-3 py-1 text-xs rounded ${rouletteChoice === c ? 'bg-amber-700' : 'bg-zinc-800'}`}
              >
                {c === 'number' ? t('casino_straight') : c === 'red' ? t('casino_red') : t('casino_black')}
              </button>
            ))}
            {rouletteChoice === 'number' && (
              <input
                type="number"
                min={0}
                max={36}
                value={rouletteNumber}
                onChange={(e) => setRouletteNumber(parseInt(e.target.value) || 0)}
                className="w-16 bg-zinc-950 border px-2 text-sm"
              />
            )}
          </div>

          <button
            onClick={playRoulette}
            disabled={busy || !player}
            className="w-full py-3 bg-gradient-to-r from-amber-700 to-yellow-600 hover:from-amber-600 rounded-xl font-bold text-lg disabled:opacity-60"
          >
            {busy ? t('casino_spinning') : t('casino_spin_button', { bet: `$${bet.toLocaleString()}` })}
          </button>
          <p className="text-[10px] text-zinc-500 mt-2">{t('casino_roulette_note')}</p>
        </div>
      </div>

      <div className="mt-8 text-xs text-zinc-500 max-w-prose">{t('casino_footer')}</div>

      <div className="mt-4">
        <Link href="/dashboard" className="text-red-400 text-sm hover:underline">
          ← {t('common_back_dashboard')}
        </Link>
      </div>
    </div>
  );
}
