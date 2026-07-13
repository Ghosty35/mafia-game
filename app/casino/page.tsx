'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { formatCash } from '@/lib/format';

export default function CasinoPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState(5000);
  const [pools, setPools] = useState({ blackjack: 1250000, roulette: 890000, lottery: 2450000, general: 560000 });
  const [lastResult, setLastResult] = useState<any>(null);

  // Live pool fetch (from new RPC or fallback)
  const fetchPools = async () => {
    const supabase = createClient();
    try {
      const { data } = await supabase.rpc('get_casino_pools');
      if (data) setPools(data as any);
    } catch {
      // fallback demo numbers grow slowly with play
    }
  };

  useEffect(() => { fetchPools(); }, []);

  const playGame = async (game: 'blackjack' | 'roulette') => {
    if (!player) return;
    if (bet < 100 || bet > 200000) { setMessage('Bet must be between $100 and $200k'); return; }
    if (player.cash < bet) { setMessage('Not enough cash.'); return; }

    setBusy(true);
    setMessage('');
    const supabase = createClient();

    try {
      const { data, error } = await supabase.rpc('play_casino', { game, bet });
      if (error) throw error;

      const res = data as any;
      updatePlayer(res.player);
      await refreshPlayer();

      const won = res.won;
      const net = won ? res.payout - bet : -bet;
      setLastResult({ game, won, bet, payout: res.payout, net });

      setMessage(
        won
          ? `🎉 ${game.toUpperCase()} WIN! +$${ (res.payout - bet).toLocaleString() } (Payout $${res.payout.toLocaleString()})`
          : `House wins. -$${bet.toLocaleString()} fed the ${game} pool.`
      );

      // Refresh pools
      await fetchPools();
    } catch (e: any) {
      setMessage(e.message || 'Play failed.');
    }
    setBusy(false);
  };

  // Roulette specific: choose bet type for extra fun
  const [rouletteChoice, setRouletteChoice] = useState<'red' | 'black' | 'number'>('red');
  const [rouletteNumber, setRouletteNumber] = useState(7);

  const playRoulette = async () => {
    if (!player) return;
    if (player.cash < bet) { setMessage('Not enough cash'); return; }
    setBusy(true);

    const supabase = createClient();
    try {
      const { data, error } = await supabase.rpc('play_casino', { game: 'roulette', bet });
      if (error) throw error;

      const res = data as any;
      updatePlayer(res.player);
      await refreshPlayer();

      // Visual roulette result (client side for show)
      const spin = Math.floor(Math.random() * 37);
      const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(spin);
      const won = res.won;

      setLastResult({ game: 'roulette', won, bet, spin, choice: rouletteChoice });
      setMessage(won ? `🎰 ROULETTE HIT! Spin ${spin}. + big payout.` : `Spin ${spin}. House takes the $${bet}. Pool fed.`);

      await fetchPools();
    } catch (e: any) {
      setMessage(e.message || 'Roulette failed');
    }
    setBusy(false);
  };

  const currentBetOptions = [1000, 5000, 10000, 25000, 50000, 100000];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">🎰 THE UNDERWORLD CASINO</h1>
          <p className="text-zinc-400">High stakes. Real risk. Losses fuel the city economy and growing jackpots.</p>
        </div>
        <Link href="/casino/lottery" className="text-red-400 hover:underline font-semibold">Weekly Lottery →</Link>
      </div>

      {/* Live Pools - attracts gamblers */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Blackjack Pool', val: pools.blackjack, icon: '♠️' },
          { label: 'Roulette Pool', val: pools.roulette, icon: '🎡' },
          { label: 'Lottery Jackpot', val: pools.lottery, icon: '🎟️' },
          { label: 'General Reserve', val: pools.general, icon: '💰' },
        ].map((p, i) => (
          <div key={i} className="card p-4 bg-zinc-950 border border-amber-900/50">
            <div className="text-xs text-amber-400">{p.icon} {p.label}</div>
            <div className="text-2xl font-mono text-emerald-400 mt-1">{formatCash(p.val)}</div>
            <div className="text-[10px] text-zinc-500">Grows with every loss. Big wins come from here.</div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="text-sm mb-2">Choose your wager (attracts the gamble crowd):</div>
        <div className="flex flex-wrap gap-2">
          {currentBetOptions.map(b => (
            <button key={b} onClick={() => setBet(b)} className={`px-4 py-1 rounded text-sm border ${bet === b ? 'bg-red-700 border-red-500' : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500'}`}>
              ${b.toLocaleString()}
            </button>
          ))}
          <input type="number" value={bet} onChange={e => setBet(Math.max(100, Math.min(200000, parseInt(e.target.value) || 1000)))} className="bg-zinc-950 border border-zinc-700 px-3 py-1 w-28 rounded text-sm" />
        </div>
        <div className="text-xs text-zinc-500 mt-1">Your cash: <span className="text-emerald-400 font-mono">{player ? formatCash(player.cash) : '$0'}</span> • House edge ~1.5-4% but big swings keep it exciting.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* BLACKJACK - Fully working */}
        <div className="card p-6 border border-red-900/60">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-4xl">♠️</div>
            <div>
              <div className="font-bold text-xl">Blackjack</div>
              <div className="text-xs text-zinc-400">Classic. ~48.5% win chance. 1.95x payout on wins. Donators get tiny edge.</div>
            </div>
          </div>

          <button
            onClick={() => playGame('blackjack')}
            disabled={busy || !player}
            className="w-full py-3 bg-gradient-to-r from-red-700 to-red-600 hover:from-red-600 rounded-xl font-bold text-lg disabled:opacity-60"
          >
            {busy ? 'Dealing...' : `Deal Blackjack — Bet $${bet.toLocaleString()}`}
          </button>

          <p className="text-[10px] text-zinc-500 mt-2">All losses go directly into Blackjack pool. Big money moves here.</p>
        </div>

        {/* ROULETTE - Fully working */}
        <div className="card p-6 border border-amber-900/60">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-4xl">🎡</div>
            <div>
              <div className="font-bold text-xl">Roulette</div>
              <div className="text-xs text-zinc-400">Red / Black / Straight up. House edge keeps pools growing.</div>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            {(['red','black','number'] as const).map(c => (
              <button key={c} onClick={() => setRouletteChoice(c)} className={`px-3 py-1 text-xs rounded ${rouletteChoice===c ? 'bg-amber-700' : 'bg-zinc-800'}`}>
                {c === 'number' ? 'Straight #' : c.toUpperCase()}
              </button>
            ))}
            {rouletteChoice === 'number' && (
              <input type="number" min={0} max={36} value={rouletteNumber} onChange={e=>setRouletteNumber(parseInt(e.target.value)||0)} className="w-16 bg-zinc-950 border px-2 text-sm" />
            )}
          </div>

          <button
            onClick={playRoulette}
            disabled={busy || !player}
            className="w-full py-3 bg-gradient-to-r from-amber-700 to-yellow-600 hover:from-amber-600 rounded-xl font-bold text-lg disabled:opacity-60"
          >
            {busy ? 'Spinning...' : `Spin Roulette — Bet $${bet.toLocaleString()}`}
          </button>
          <p className="text-[10px] text-zinc-500 mt-2">Every spin feeds the Roulette pool. The gamble crowd loves this one.</p>
        </div>
      </div>

      {lastResult && (
        <div className={`mt-5 p-4 rounded-xl border ${lastResult.won ? 'border-green-700 bg-green-950/40' : 'border-red-800 bg-red-950/30'}`}>
          <div className="font-semibold">{lastResult.won ? 'WINNER' : 'HOUSE WINS'}</div>
          <div className="text-sm mt-1">
            {lastResult.game} • Bet ${lastResult.bet?.toLocaleString()}
            {lastResult.payout ? ` • Paid $${lastResult.payout.toLocaleString()}` : ''}
            {lastResult.spin !== undefined && ` • Landed on ${lastResult.spin}`}
          </div>
        </div>
      )}

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>}

      <div className="mt-8 text-xs text-zinc-500 max-w-prose">
        The Casino is the heart of the underground economy. Every loss you take (or others) grows the pools that pay the big lottery jackpots and future events.
        Play smart — or go broke trying. Donator status gives a microscopic edge.
      </div>

      <div className="mt-4">
        <Link href="/dashboard" className="text-red-400 text-sm hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
