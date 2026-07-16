'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type Cooldown = { key: string; available_at: string | null };

// Same fixed keys as WaitTimesBoard; crime:/heist: prefixes are dynamic.
const FIXED: Record<string, { icon: string; labelKey: TranslationKey }> = {
  murder: { icon: '🔫', labelKey: 'cd_murder' },
  jail: { icon: '🔒', labelKey: 'cd_jail' },
  death: { icon: '💀', labelKey: 'cd_death' },
  lottery: { icon: '🎟️', labelKey: 'cd_lottery' },
  family_hourly: { icon: '💰', labelKey: 'cd_family_hourly' },
};

function prettify(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function LiveTracker() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_my_cooldowns');
      if (Array.isArray(data)) setCooldowns(data as Cooldown[]);
    };
    load();
    const poll = setInterval(load, 10000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const active = useMemo(() => {
    const remaining = (at: string | null) =>
      at ? Math.max(0, Math.floor((new Date(at).getTime() - now) / 1000)) : 0;

    return cooldowns
      .map((cd) => {
        const secs = remaining(cd.available_at);
        if (cd.key.startsWith('crime:')) {
          return { icon: '🔪', label: prettify(cd.key.slice(6)), secs };
        }
        if (cd.key.startsWith('heist:')) {
          return { icon: '💣', label: prettify(cd.key.slice(6)), secs };
        }
        const fixed = FIXED[cd.key];
        return fixed ? { icon: fixed.icon, label: t(fixed.labelKey), secs } : null;
      })
      .filter((it): it is { icon: string; label: string; secs: number } => !!it && it.secs > 0)
      .sort((a, b) => a.secs - b.secs);
  }, [cooldowns, now, t]);

  return (
    <div className="card p-4 mb-4 bg-zinc-900 border border-zinc-700">
      <h3 className="font-bold mb-2 flex items-center gap-2">{t('tracker_title')}</h3>

      {active.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
          {active.map((it, i) => (
            <div
              key={`${it.label}-${i}`}
              className="flex items-center justify-between gap-2 p-2 bg-zinc-950 rounded"
            >
              <span className="truncate">
                {it.icon} {it.label}
              </span>
              <span className="font-mono text-orange-400 tabular-nums shrink-0">{fmt(it.secs)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-emerald-500 mb-2">✅ {t('tracker_all_ready')}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_weed')}{' '}
          {player?.weed_progress !== undefined ? `${player.weed_progress}/5` : t('tracker_no_plants')}
        </div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">{t('tracker_bills')}</div>
        <div className="flex items-center gap-2 p-2 bg-zinc-950 rounded">
          {t('tracker_bullets')} {player?.bullets || 0}
        </div>
        <Link
          href="/wachttijden"
          className="flex items-center gap-2 p-2 bg-zinc-950 rounded hover:bg-zinc-800 transition text-zinc-400"
        >
          ⏱️ {t('tracker_all_link')} →
        </Link>
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">{t('tracker_footer')}</p>
    </div>
  );
}
