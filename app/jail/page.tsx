'use client';

import { useState, useEffect } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function JailPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [breakoutSkill, setBreakoutSkill] = useState(10);
  const [message, setMessage] = useState('');

  // Sync breakout skill from player when available
  useEffect(() => {
    if (player?.breakout_skill !== undefined) {
      setBreakoutSkill(player.breakout_skill);
    }
  }, [player?.breakout_skill]);

  const jailedPlayers = [
    { username: 'Rival1', time: '45m', city: 'New York' },
    { username: 'Thief2', time: '20m', city: 'Chicago' },
    // Demo list, in real pull from server
  ];

  const trainBreakout = async () => {
    if (!player) return;
    const cost = 500;
    if (player.cash < cost) {
      setMessage('Not enough cash to train.');
      return;
    }
    const newSkill = Math.min(100, breakoutSkill + 5);
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', {
      cash_delta: -cost,
      patch: { breakout_skill: newSkill },
    });
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash to train.' : (error.message || 'Training failed.'));
      return;
    }
    setBreakoutSkill(newSkill);
    setMessage(`Trained breakout experience! Skill now ${newSkill}%.`);
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
  };

  const attemptBreakout = async () => {
    if (!player?.jailed_until) {
      setMessage('You are not in jail.');
      return;
    }
    // Escape roll happens server-side (attempt_breakout RPC)
    const supabase = createClient();
    const { data, error } = await supabase.rpc('attempt_breakout');
    if (error) {
      setMessage(error.message.includes('NOT_IN_JAIL') ? 'You are not in jail.' : (error.message || 'Breakout failed.'));
      return;
    }
    setMessage(data?.success ? 'Breakout successful! You escaped.' : `Failed breakout. +${data?.added_minutes || 5} minutes added.`);
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🔒 City Jail</h1>
      <p className="text-sm text-zinc-400 mb-6">See who's locked up. Train your breakout skills like in Bulletstar.</p>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">Inmates (Live Demo)</h3>
        {jailedPlayers.map((j, idx) => (
          <div key={idx} className="text-sm mb-1">{j.username} - {j.time} in {j.city}</div>
        ))}
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">Your Breakout Training</h3>
        <div>Skill: {breakoutSkill}%</div>
        <button onClick={trainBreakout} className="mt-2 px-4 py-1 bg-blue-700 rounded text-sm">Train (+5% for $500)</button>
        {player?.jailed_until && <button onClick={attemptBreakout} className="ml-2 px-4 py-1 bg-red-700 rounded text-sm">Attempt Breakout</button>}
      </div>

      {message && <div className="p-3 bg-zinc-900 rounded">{message}</div>}

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
