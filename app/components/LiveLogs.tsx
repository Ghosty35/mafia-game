'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function LiveLogs() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [logs, setLogs] = useState(() => [
    { time: new Date().toLocaleTimeString(), msg: t('logs_server_started') },
  ]);

  // Keep the username in a ref so the ticker interval below never has to
  // restart when the player object refreshes. This keeps the news widget
  // fully standalone: clicking buttons elsewhere no longer re-triggers it.
  const usernameRef = useRef<string>('Player');
  useEffect(() => {
    if (player?.username) usernameRef.current = player.username;
  }, [player?.username]);

  // Keep t in a ref for the same reason: the interval survives language
  // switches, but new events use the latest language.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate live game activity
      const tr = tRef.current;
      const events = [
        tr('logs_event_promoted', { name: usernameRef.current }),
        tr('logs_event_heist'),
        tr('logs_event_kill'),
        tr('logs_event_war'),
        tr('logs_event_joined'),
      ];
      if (Math.random() > 0.7) {
        const newLog = {
          time: new Date().toLocaleTimeString(),
          msg: events[Math.floor(Math.random() * events.length)],
        };
        setLogs((prev) => [newLog, ...prev].slice(0, 10));
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card p-4 mb-4 bg-zinc-900 border border-zinc-700">
      <h3 className="font-bold mb-2">{t('logs_title')}</h3>
      <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
        {logs.map((log, i) => (
          <div key={i}>
            [{log.time}] {log.msg}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">{t('logs_footer')}</p>
    </div>
  );
}
