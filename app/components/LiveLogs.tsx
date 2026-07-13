'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';

export default function LiveLogs() {
  const { player } = usePlayer();
  const [logs, setLogs] = useState([
    { time: new Date().toLocaleTimeString(), msg: 'Server started. Welcome to 2026.' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate live game activity
      const events = [
        `${player?.username || 'Player'} promoted to new rank!`,
        'Big heist robbed in New York!',
        'Rival killed in Chicago.',
        'Family war started.',
        'New player joined the streets.',
      ];
      if (Math.random() > 0.7) {
        const newLog = { time: new Date().toLocaleTimeString(), msg: events[Math.floor(Math.random() * events.length)] };
        setLogs(prev => [newLog, ...prev].slice(0, 10));
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [player]);

  return (
    <div className="card p-4 mb-4 bg-zinc-900 border border-zinc-700">
      <h3 className="font-bold mb-2">📜 Live Game Logs (Widget)</h3>
      <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
        {logs.map((log, i) => (
          <div key={i}>[{log.time}] {log.msg}</div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">Live updates: promotions, kills, heists, activities. Synced.</p>
    </div>
  );
}
