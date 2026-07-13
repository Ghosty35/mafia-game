'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { CITIES } from '@/lib/cities';

export default function DetectivePage() {
  const { player } = usePlayer();
  const [targetName, setTargetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const supabase = createClient();

  const requestSearch = async () => {
    if (!player || !targetName.trim()) return;

    setBusy(true);
    setMessage('Detective is searching... (15 min simulation)');

    // Simulate 15 min search (in real, use DB timer or cron)
    setTimeout(async () => {
      // Find a random city for demo
      const foundCity = CITIES[Math.floor(Math.random() * CITIES.length)];

      // Send message
      await supabase.from('messages').insert({
        to_player_id: player.id,
        from_player_id: player.id, // system for now
        subject: 'Detective Report',
        body: `Detective found ${targetName} in ${foundCity}. You have 5 minutes to travel there and kill them!`,
      });

      setMessage(`Search complete! Check your Messages. ${targetName} spotted in ${foundCity}.`);
      setBusy(false);
    }, 5000); // 5 sec for demo instead of 15 min
  };

  if (!player) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🕵️ Detective Agency</h1>
      <p className="text-sm text-zinc-400 mb-6">Request a search for a player. Results come via in-game message.</p>

      <div className="card p-6">
        <input
          type="text"
          placeholder="Player name to find"
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-2 mb-4"
        />

        <button
          onClick={requestSearch}
          disabled={busy || !targetName.trim()}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold disabled:opacity-50"
        >
          {busy ? 'Searching...' : 'Request Search ($500)'}
        </button>
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        Cost: $500. Search takes 15 real minutes. Results sent via Messages. You have 5 min to act after notification.
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
