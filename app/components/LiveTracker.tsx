'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';

export default function LiveTracker() {
  const { player } = usePlayer();
  const [timers, setTimers] = useState<any>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const newTimers: any = {};
      if (player?.murder_cooldown) {
        const end = new Date(player.murder_cooldown).getTime();
        newTimers.murder = Math.max(0, Math.floor((end - now) / 1000));
      }
      if (player?.weed_progress !== undefined) {
        newTimers.weed = player.weed_progress; // 0-5
      }
      // Add heist, crime cooldowns from player if stored
      if (player?.heist_cooldown) {
        const end = new Date(player.heist_cooldown).getTime();
        newTimers.heist = Math.max(0, Math.floor((end - now) / 1000));
      }
      setTimers(newTimers);
    }, 1000);
    return () => clearInterval(interval);
  }, [player]);

  return (
    <div className="card p-4 mb-4 bg-zinc-900 border border-zinc-700">
      <h3 className="font-bold mb-2 flex items-center gap-2">📊 Live Trackers & Countdowns ⏱️</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          🔫 Murder: {timers.murder ? `${Math.floor(timers.murder/60)}m ${timers.murder%60}s` : 'Ready ✅'}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          🌱 Weed: {timers.weed !== undefined ? `${timers.weed}/5` : 'No plants'}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          💣 Heist: {timers.heist ? `${Math.floor(timers.heist/3600)}h` : 'Ready ✅'}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          💰 Bills: Check Real Estate
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          🔫 Bullets: {player?.bullets || 0}
        </div>
        {/* Extend with more from player context (crime cooldowns, etc.) */}
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">Live updates every second. More timers (crimes, grow, etc.) can be added here.</p>
    </div>
  );
}
