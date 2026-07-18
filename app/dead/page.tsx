'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function DeadPage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });

  useEffect(() => {
    if (!player?.death_until) return;

    const tick = () => {
      const deathTime = new Date(player.death_until!).getTime();
      const now = Date.now();
      const diff = Math.max(0, deathTime - now);
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft({ h, m, s });

      if (diff <= 0) {
        window.location.href = '/dashboard';
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [player?.death_until]);

  if (!player) return <div>{t('loading')}</div>;

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <div className="max-w-md text-center">
        <h1 className="text-5xl font-bold mb-2 text-red-600 animate-pulse">☠️ {t('dead_title')}</h1>
        <p className="text-xl mb-6 text-zinc-300">{t('dead_respawn_in')}</p>

        <div className="bg-zinc-900 border border-red-900/50 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-center gap-3 text-4xl font-mono font-bold text-red-400">
            <span>{pad(timeLeft.h)}</span>
            <span className="text-red-600 animate-pulse">:</span>
            <span>{pad(timeLeft.m)}</span>
            <span className="text-red-600 animate-pulse">:</span>
            <span>{pad(timeLeft.s)}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-2">HH : MM : SS</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
          <p className="text-sm text-zinc-500">{t('dead_respawn_note')}</p>
        </div>

        <p className="text-xs text-zinc-600">{t('dead_respawn_note')}</p>

        <button
          onClick={async () => {
            if (player) {
              const supabase = (await import('@/lib/supabase/client')).createClient();
              await supabase.rpc('force_respawn');
              window.location.href = '/dashboard';
            }
          }}
          className="mt-4 px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
        >
          {t('dead_force_respawn')}
        </button>
      </div>
    </div>
  );
}
