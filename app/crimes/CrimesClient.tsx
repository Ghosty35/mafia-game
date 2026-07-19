'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { formatCash, formatSeconds } from '@/lib/format';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import PageHeader from '../components/PageHeader';

export default function CrimesClient({
  initialPlayer,
  crimes,
  initialCooldowns,
  hideHeader = false,
}: {
  initialPlayer: Player | null;
  crimes: Crime[];
  initialCooldowns: CooldownRow[];
  hideHeader?: boolean;
}) {
  const { t, language } = useLanguage();
  const { player: contextPlayer } = usePlayer();
  const [localPlayer] = useState<Player | null>(initialPlayer);
  const player = contextPlayer || localPlayer;
  const [cooldowns, setCooldowns] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialCooldowns.map((row) => [row.crime_key, Date.parse(row.available_at)])
    )
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const sync = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_my_cooldowns');
      if (Array.isArray(data)) {
        setCooldowns((prev) => {
          const next = { ...prev };
          (data as Array<{ key: string; available_at: string | null }>).forEach((row) => {
            if (row.available_at) next[row.key] = Date.parse(row.available_at);
          });
          return next;
        });
      }
    };
    sync();
    const poll = setInterval(sync, 10000);
    return () => clearInterval(poll);
  }, []);

  if (!player) {
    return (
      <div className="p-8">
        <p className="text-red-500">Could not load player data.</p>
      </div>
    );
  }

  const jailSecondsLeft = player.jailed_until
    ? Math.max(0, Math.ceil((new Date(player.jailed_until).getTime() - now) / 1000))
    : 0;
  const inJail = jailSecondsLeft > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${player.username || 'Boss'}, Welcome.`}
        subtitle="Commit crimes to build your empire."
        icon="🔫"
        variant="danger"
      />

      {(!hideHeader || crimes.length > 1) && inJail && (
        <div className="bg-orange-950/60 border border-orange-800/50 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
          <p className="font-semibold text-orange-300">🚔 {t('jail_banner')}</p>
          <p className="text-orange-200 font-mono text-xs">
            {t('jail_release_in')} {formatSeconds(jailSecondsLeft)}
          </p>
        </div>
      )}

      {/* Crime Status / Info only - NO commit buttons here.
          Commit buttons live only on the standalone dedicated pages. */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">🔫 {t('crimes_title')}</h2>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status &amp; Info • Click to commit</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {crimes.map((crime) => {
            const locked = player.level < crime.min_level;
            const availableAt = cooldowns[crime.key] ?? 0;
            const secondsLeft = Math.max(0, Math.ceil((availableAt - now) / 1000));
            const coolingDown = secondsLeft > 0;

            return (
              <Link
                key={crime.key}
                href={`/crimes/${crime.key}`}
                className={`group block bg-zinc-900 border border-zinc-800 rounded-xl p-4 transition-all hover:border-amber-700/50 hover:shadow-[0_0_15px_rgba(245,158,11,0.06)] ${
                  locked ? 'opacity-50' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div>
                    <h3 className="font-semibold text-sm leading-tight">
                      {t(`crime_${crime.key}` as TranslationKey)}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-snug pr-2">
                      {t(`crime_${crime.key}_desc` as TranslationKey)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-[10px] text-zinc-500 font-mono pt-0.5 uppercase tracking-wider">
                    {coolingDown ? `⏱ ${formatSeconds(secondsLeft)}` : formatSeconds(crime.cooldown_seconds)}
                  </div>
                </div>

                <div className="flex items-center gap-x-3 text-xs mb-3 text-zinc-400">
                  <span className="font-medium text-emerald-400/90">
                    {formatCash(crime.min_reward, language)}–{formatCash(crime.max_reward, language)}
                  </span>
                  <span className="text-zinc-700">•</span>
                  <span>
                    {Math.round(crime.success_chance * 100)}% {t('crime_success_rate')}
                  </span>
                  {locked && (
                    <span className="ml-auto text-amber-400/80 font-medium text-[10px] uppercase tracking-wider">🔒 Lvl {crime.min_level}</span>
                  )}
                </div>

                {/* Cooldown status */}
                {coolingDown && (
                  <div className="text-[10px] text-amber-400/80 mb-2 uppercase tracking-wider">
                    Ready in {formatSeconds(secondsLeft)}
                  </div>
                )}

                {/* Info hint - no action button on status page */}
                <div className="mt-2 text-xs text-amber-400 font-medium flex items-center gap-1 group-hover:text-amber-300 transition-colors">
                  View details &amp; commit →
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {(!hideHeader || crimes.length > 1) && (
        <div className="text-center text-xs text-zinc-600 pt-4">
          Click any crime above to go to its standalone page where you can commit.
        </div>
      )}
    </div>
  );
}
