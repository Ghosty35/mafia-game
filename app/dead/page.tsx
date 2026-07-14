'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function DeadPage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!player?.death_until) return;

    const interval = setInterval(() => {
      const deathTime = new Date(player.death_until!).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((deathTime - now) / 1000 / 60));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        // Respawn logic would be in context or server
        window.location.href = '/dashboard';
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [player?.death_until]);

  if (!player) return <div>{t('loading')}</div>;

  const killer = t('dead_unknown_killer'); // In real, store who killed you

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4 text-red-600">{t('dead_title')}</h1>
        <p className="text-xl mb-2">{t('dead_killed_by')} <span className="font-semibold">{killer}</span></p>
        <p className="mb-6">{t('dead_duration', { minutes: timeLeft })}</p>
        
        <div className="bg-zinc-900 p-4 rounded mb-6">
          <p className="text-sm text-zinc-400">{t('dead_leaderboard_note')}</p>
          <a href="/leaderboard" className="text-red-400 hover:underline">{t('dead_go_leaderboard')}</a>
        </div>

        <p className="text-xs text-zinc-500">{t('dead_respawn_note')}</p>

        <button 
          onClick={async () => {
            if (player) {
              const supabase = createClient();
              await supabase.rpc('force_respawn');
              window.location.href = '/dashboard';
            }
          }}
          className="mt-4 px-4 py-2 bg-red-700 rounded text-sm"
        >
          {t('dead_force_respawn')}
        </button>
      </div>
    </div>
  );
}
