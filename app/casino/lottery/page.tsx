'use client';

import { useState, useEffect } from 'react';
import { usePlayer } from '../../components/PlayerContext';

export default function LotteryPage() {
  const { player, refreshPlayer } = usePlayer();
  const [message, setMessage] = useState('');
  const [timeToFriday, setTimeToFriday] = useState('');

  // Simple Friday timer (demo)
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const day = now.getDay();
      const daysToFriday = (5 - day + 7) % 7 || 7;
      const friday = new Date(now);
      friday.setDate(now.getDate() + daysToFriday);
      friday.setHours(12, 0, 0, 0); // Friday noon
      const diff = friday.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeToFriday(`${hours}h ${mins}m until Friday draw`);
    };
    updateTimer();
    const iv = setInterval(updateTimer, 60000);
    return () => clearInterval(iv);
  }, []);

  const isDonator = player?.is_donator;
  const tickets = isDonator ? 1 : 3; // Non-donators get more tickets for better odds

  const enterLottery = async () => {
    if (!player) return;
    // Draw happens server-side (enter_weekly_lottery RPC):
    // donators 14%, non-donators 37%, big pool pays an 8% slice.
    const supabase = (await import('@/lib/supabase/client')).createClient();
    const { data, error } = await supabase.rpc('enter_weekly_lottery');
    if (error) {
      setMessage(error.message || 'Lottery entry failed. Try again.');
      return;
    }
    if (data?.won) {
      setMessage(`🎉 FRIDAY DRAW WINNER! Cash Jackpot — $${(data.prize || 0).toLocaleString()}. Cash added.`);
      await refreshPlayer?.();
    } else {
      setMessage('Tough draw. Non-donators get better odds to keep the economy moving. Try again next Friday!');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">🎟️ Weekly Friday Lottery</h1>
      <p className="text-sm text-zinc-400 mb-4">Draw happens every Friday. Prizes include cash, items, and jackpots.</p>

      <div className="card p-6 mb-6">
        <h3 className="font-bold mb-3">Your Tickets This Week</h3>
        <div className="text-2xl font-mono">{tickets} ticket{tickets > 1 ? 's' : ''}</div>
        <p className="text-xs text-zinc-400 mt-1">
          {isDonator 
            ? "As a Donator you get 1 ticket. Non-donators receive 3 tickets for better odds." 
            : "Non-donators get 3 tickets. Donators get 1. This gives regular players a fair shot at big wins."}
        </p>
      </div>

      <button 
        onClick={enterLottery}
        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-xl font-semibold"
      >
        Enter This Week's Draw
      </button>

      {message && (
        <div className="mt-4 p-4 bg-zinc-900 border border-yellow-700 rounded">
          {message}
        </div>
      )}

      <div className="mt-8 text-xs text-zinc-500">
        Lottery prizes are drawn every Friday. Jackpot and item pools grow with casino losses. {timeToFriday}
      </div>

      <a href="/casino" className="mt-4 inline-block text-sm text-red-400">← Back to Casino</a>
    </div>
  );
}
