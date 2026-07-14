'use client';

import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type Timers = {
  murder?: number;
  weed?: number;
  heist?: number;
};

export default function LiveTracker() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [timers, setTimers] = useState<Timers>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const newTimers: Timers = {};
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
      <h3 className="font-bold mb-2 flex items-center gap-2">{t('tracker_title')}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_murder')}{' '}
          {timers.murder ? `${Math.floor(timers.murder / 60)}m ${timers.murder % 60}s` : t('tracker_ready')}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_weed')} {timers.weed !== undefined ? `${timers.weed}/5` : t('tracker_no_plants')}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_heist')} {timers.heist ? `${Math.floor(timers.heist / 3600)}h` : t('tracker_ready')}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">{t('tracker_bills')}</div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_bullets')} {player?.bullets || 0}
        </div>
        {/* Extend with more from player context (crime cooldowns, etc.) */}
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">{t('tracker_footer')}</p>
    </div>
  );
}
