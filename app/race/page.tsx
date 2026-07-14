'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';

interface PostedRace {
  id: string;
  poster: string;
  car: string;
  bet: number;
  expireAt: number;
  joinedBy?: string;
  status: 'open' | 'ready' | 'expired';
}

export default function RacePage() {
  const { player, refreshPlayer } = usePlayer();
  const [postedRaces, setPostedRaces] = useState<PostedRace[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [bet, setBet] = useState(500);
  const [expireMinutes, setExpireMinutes] = useState(60);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const cars = player?.cars || [];
  const validCars = cars.filter((c: any) => (c.health || 100) >= 75);

  // Live countdown for posted races
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setPostedRaces(prev => prev.map(r => {
        if (r.status === 'open' && now > r.expireAt) {
          return { ...r, status: 'expired' };
        }
        return r;
      }));
      if (cooldown > 0) setCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [cooldown]);

  const postRace = async () => {
    if (!player || !selectedCarId || validCars.length === 0) {
      setMessage('Select a valid car (75%+ health) to post race.');
      return;
    }
    const car = cars.find((c: any) => c.id === selectedCarId);
    if (!car || (car.health || 100) < 75) {
      setMessage('Car must have at least 75% health.');
      return;
    }
    const entryFee = Math.max(100, Math.floor(bet * 0.1)); // 10% entry fee balanced
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: -entryFee, patch: {} });
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough for entry fee.' : (error.message || 'Failed to post race.'));
      return;
    }
    const expireAt = Date.now() + expireMinutes * 60 * 1000;
    const newRace: PostedRace = {
      id: Date.now().toString(),
      poster: player.username || 'You',
      car: car.name,
      bet,
      expireAt,
      status: 'open'
    };
    setPostedRaces(prev => [...prev, newRace]);
    if (refreshPlayer) await refreshPlayer();
    setMessage(`Race posted! Entry fee $${entryFee}. Expires in ${expireMinutes} min.`);
  };

  const joinRace = async (race: PostedRace) => {
    if (!player) return;
    const entryFee = Math.max(100, Math.floor(race.bet * 0.1));
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: -entryFee, patch: {} });
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough for entry fee.' : (error.message || 'Failed to join race.'));
      return;
    }
    setPostedRaces(prev => prev.map(r => r.id === race.id ? { ...r, joinedBy: player.username || 'Opponent', status: 'ready' } : r));
    if (refreshPlayer) await refreshPlayer();
    setMessage(`Joined ${race.poster}'s race. Ready to start!`);
  };

  const startRace = async (race: PostedRace) => {
    if (!player || !race.joinedBy) {
      setMessage('No opponent joined yet.');
      return;
    }
    if (cooldown > 0) {
      setMessage(`Cooldown ${cooldown}s remaining.`);
      return;
    }
    const win = Math.random() > 0.5;
    const pot = race.bet * 2;
    const winner = win ? player.username : race.joinedBy;
    const loser = win ? race.joinedBy : player.username;
    const delta = win ? pot : -Math.min(race.bet, player.cash);
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: delta, patch: {} });
    if (error) {
      setMessage(error.message || 'Race failed to settle.');
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    setHistory(prev => [...prev, { winner, loser, amount: pot, time: new Date().toISOString() }]);
    setMessage(win ? `You won the race vs ${race.joinedBy}! +$${pot}` : `You lost to ${race.joinedBy}. -$${race.bet}`);
    setCooldown(600); // 10 min
    setPostedRaces(prev => prev.filter(r => r.id !== race.id));
  };

  const cancelRace = (id: string) => {
    setPostedRaces(prev => prev.filter(r => r.id !== id));
    setMessage('Race canceled.');
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏁 Racing - 2 Player Events</h1>
      <p className="text-sm text-zinc-400 mb-6">Post a race with timer. Opponent joins. Entry fee. 10min cooldown after. History below.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Post Race */}
        <div className="card p-5">
          <h3 className="font-bold mb-2">Post a Race</h3>
          <select value={selectedCarId} onChange={e => setSelectedCarId(e.target.value)} className="mb-2 w-full bg-zinc-900 border px-2 py-1">
            <option value="">Select Car (75%+ health)</option>
            {validCars.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.health || 100}%)</option>)}
          </select>
          <div className="mb-2">Bet: <input type="number" value={bet} onChange={e => setBet(parseInt(e.target.value) || 500)} className="bg-zinc-900 px-2 py-1 w-24" /></div>
          <select value={expireMinutes} onChange={e => setExpireMinutes(parseInt(e.target.value))} className="mb-2 bg-zinc-900 px-2 py-1">
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
          </select>
          <button onClick={postRace} className="w-full py-2 bg-red-700 rounded">Post Race (Entry fee applies)</button>
        </div>

        {/* Open Races */}
        <div className="card p-5">
          <h3 className="font-bold mb-2">Open Races (Live Trackers)</h3>
          {postedRaces.length === 0 && <p className="text-xs">No open races. Post one!</p>}
          {postedRaces.map(race => {
            const timeLeft = Math.max(0, Math.floor((race.expireAt - Date.now()) / 1000 / 60));
            return (
              <div key={race.id} className="mb-2 p-2 bg-zinc-950 rounded text-sm">
                {race.poster} vs ? | Bet ${race.bet} | Car: {race.car} | Expires: {timeLeft}m
                {race.status === 'open' && race.poster !== (player?.username || '') && (
                  <button onClick={() => joinRace(race)} className="ml-2 px-2 py-0.5 bg-emerald-700 text-xs rounded">Join</button>
                )}
                {race.status === 'ready' && (
                  <button onClick={() => startRace(race)} className="ml-2 px-2 py-0.5 bg-red-700 text-xs rounded">Start Race</button>
                )}
                <button onClick={() => cancelRace(race.id)} className="ml-2 px-2 py-0.5 bg-zinc-700 text-xs rounded">Cancel</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold mb-2">Race History</h3>
        {history.length === 0 && <p className="text-xs">No races yet.</p>}
        {history.map((h, i) => (
          <div key={i} className="text-xs mb-1">{h.winner} beat {h.loser} for ${h.amount} at {new Date(h.time).toLocaleTimeString()}</div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700">{message}</div>}

      <div className="mt-4 text-xs text-zinc-500">Cooldown after race: {cooldown}s (live in trackers)</div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
