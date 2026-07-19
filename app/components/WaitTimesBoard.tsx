'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type Cooldown = { key: string; available_at: string | null };

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
  if (secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

type RowItem = { icon: string; label: string; secs: number };

const Row = ({ icon, label, secs, t }: RowItem & { t: (k: TranslationKey) => string }) => (
  <div className="flex items-center justify-between gap-2 p-2 bg-zinc-950 rounded border border-zinc-800 text-xs">
    <span className="flex items-center gap-2 truncate">
      <span>{icon}</span>
      <span className="truncate">{label}</span>
    </span>
    {secs > 0 ? (
      <span className="font-mono text-orange-400 tabular-nums shrink-0">{fmt(secs)}</span>
    ) : (
      <span className="text-emerald-500 shrink-0">{t('cd_ready')}</span>
    )}
  </div>
);

const Group = ({
  titleKey,
  items,
  t,
}: {
  titleKey: TranslationKey;
  items: RowItem[];
  t: (k: TranslationKey) => string;
}) => {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">{t(titleKey)}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((it, i) => (
          <Row key={`${it.label}-${i}`} {...it} t={t} />
        ))}
      </div>
    </div>
  );
};

export default function WaitTimesBoard() {
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
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const groups = useMemo(() => {
    const actions: RowItem[] = [];
    const crimes: RowItem[] = [];
    const heists: RowItem[] = [];

    const remaining = (at: string | null) =>
      at ? Math.max(0, Math.floor((new Date(at).getTime() - now) / 1000)) : 0;

    for (const cd of cooldowns) {
      const secs = remaining(cd.available_at);
      if (cd.key.startsWith('crime:')) {
        crimes.push({ icon: '🔪', label: prettify(cd.key.slice(6)), secs });
      } else if (cd.key.startsWith('heist:')) {
        heists.push({ icon: '💣', label: prettify(cd.key.slice(6)), secs });
      } else if (FIXED[cd.key]) {
        actions.push({ icon: FIXED[cd.key].icon, label: t(FIXED[cd.key].labelKey), secs });
      }
    }
    // Extra info rows from the live player object.
    actions.push({ icon: '🥷', label: t('cd_rip'), secs: 0 });
    if (player?.weed_progress !== undefined) {
      actions.push({ icon: '🌱', label: `${t('cd_weed')} (${player.weed_progress}/5)`, secs: 0 });
    }
    actions.push({ icon: '🔫', label: `${t('cd_bullets')}: ${player?.bullets ?? 0}`, secs: 0 });

    return { actions, crimes, heists };
  }, [cooldowns, now, player?.weed_progress, player?.bullets, t]);

  const empty = groups.actions.length === 0 && groups.crimes.length === 0 && groups.heists.length === 0;

  return (
    <div className="card p-5 bg-zinc-900 border border-zinc-700 space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">⏱️ {t('cd_title')}</h2>
        <p className="text-xs text-zinc-400">{t('cd_desc')}</p>
      </div>
      {empty ? (
        <p className="text-sm text-zinc-500 py-4 text-center">{t('cd_none')}</p>
      ) : (
        <>
          <Group titleKey="cd_group_actions" items={groups.actions} t={t} />
          <Group titleKey="cd_group_crimes" items={groups.crimes} t={t} />
          <Group titleKey="cd_group_heists" items={groups.heists} t={t} />
        </>
      )}
    </div>
  );
}
