'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type GameEvent = {
  id: number;
  created_at: string;
  username: string;
  event_type: string;
  message: string;
};

// Map an event type to an icon for the ticker (falls back to a generic dot).
const EVENT_ICON: Record<string, string> = {
  heist: '💣',
  promotion: '⭐',
  family: '👥',
  race: '🏁',
  murder: '🔫',
  crime: '🚔',
  war: '⚔️',
  territory: '🗺️',
  rip: '🥷',
  bust: '🚨',
};

function timeAgo(iso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function LiveLogs() {
  const { t } = useLanguage();
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [, force] = useState(0); // re-render so relative times tick
  const [now, setNow] = useState(() => Date.now());

  // Keep the supabase client stable so the poll interval never restarts.
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const load = async () => {
      const { data } = await supabaseRef.current.rpc('get_recent_events', { limit_count: 20 });
      if (Array.isArray(data)) setEvents(data as GameEvent[]);
    };
    load();
    const poll = setInterval(load, 12000);
    const tick = setInterval(() => {
      force((n) => n + 1);
      setNow(Date.now());
    }, 30000); // refresh "Xs ago"
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="card p-4 bg-zinc-900 border border-zinc-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold flex items-center gap-2">
          📡 {t('logs_title')}
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </h3>
        <span className="text-[10px] text-zinc-500">{t('feed_live')}</span>
      </div>
      <div className="max-h-56 overflow-auto pr-1 space-y-1">
        {events.length === 0 ? (
          <div className="text-xs text-zinc-500 py-4 text-center">{t('feed_empty')}</div>
        ) : (
          events.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-2 text-xs border-b border-zinc-800/60 pb-1 last:border-0"
            >
              <span className="mt-px">{EVENT_ICON[e.event_type] ?? '•'}</span>
              <span className="flex-1 leading-snug">
                <span className="font-semibold text-red-400">{e.username}</span>{' '}
                <span className="text-zinc-300">{e.message}</span>
              </span>
              <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap">{timeAgo(e.created_at, now)}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-[10px] text-zinc-500 mt-2">{t('logs_footer')}</p>
    </div>
  );
}
