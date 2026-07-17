'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { formatCash, formatSeconds } from '@/lib/format';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

export default function CrimesClient({
  initialPlayer,
  crimes,
  initialCooldowns,
  familyStatus,
  hideHeader = false,
}: {
  initialPlayer: Player | null;
  crimes: Crime[];
  initialCooldowns: CooldownRow[];
  familyStatus?: {
    family_id: string | null;
    family_name: string | null;
    family_tag: string | null;
    family_respect: number | null;
    my_role: string | null;
  } | null;
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">{player.username || 'Boss'}, Welcome.</h1>
        <p className="text-zinc-500">Commit crimes to build your empire.</p>
      </div>

      {(!hideHeader || crimes.length > 1) && inJail && (
        <div className="card bg-orange-950/60 border border-orange-800 px-4 py-3 flex items-center justify-between text-sm">
          <p className="font-semibold text-orange-300">🚔 {t('jail_banner')}</p>
          <p className="text-orange-200 font-mono">
            {t('jail_release_in')} {formatSeconds(jailSecondsLeft)}
          </p>
        </div>
      )}

      {/* Crime Status / Info only - NO commit buttons here.
          Commit buttons live only on the standalone dedicated pages. */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold tracking-tight">🔫 {t('crimes_title')}</h2>
          <span className="text-xs text-zinc-500">Status &amp; Info • Click to commit</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {crimes.map((crime) => {
            const locked = player.level < crime.min_level;
            const availableAt = cooldowns[crime.key] ?? 0;
            const secondsLeft = Math.max(0, Math.ceil((availableAt - now) / 1000));
            const coolingDown = secondsLeft > 0;
            let effectiveCooldown = Math.round(
              crime.cooldown_seconds * (1 - Math.min(player.rebirths * 0.1, 0.5))
            );
            if (player.is_donator) effectiveCooldown = Math.round(effectiveCooldown * 0.8); // 20% global cooldown reduction for donators

            return (
              <Link
                key={crime.key}
                href={`/crimes/${crime.key}`}
                className={`group block crime-card bg-zinc-900 border border-zinc-800 transition-all hover:border-red-900/60 hover:-translate-y-px ${
                  locked ? 'opacity-60' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div>
                    <h3 className="font-semibold text-base leading-tight">
                      {t(`crime_${crime.key}` as TranslationKey)}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-snug pr-2">
                      {t(`crime_${crime.key}_desc` as TranslationKey)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-xs text-zinc-400 font-mono pt-0.5">
                    ⏱ {formatSeconds(effectiveCooldown)}
                  </div>
                </div>

                <div className="flex items-center gap-x-3 text-xs mb-3 text-zinc-400">
                  <span className="font-medium text-emerald-400/90">
                    {formatCash(crime.min_reward, language)}–{formatCash(crime.max_reward, language)}
                  </span>
                  <span className="text-zinc-600">•</span>
                  <span>
                    {Math.round(crime.success_chance * 100)}% {t('crime_success_rate')}
                  </span>
                  <span className="ml-2 text-blue-400">
                    Your: {Math.round((crime.success_chance * 100) * 0.8)}% (live)
                  </span>
                  {locked && (
                    <span className="ml-auto text-amber-400/80 font-medium">🔒 Lvl {crime.min_level}</span>
                  )}
                </div>

                {/* Cooldown status */}
                {coolingDown && (
                  <div className="text-xs text-amber-400 mb-2">
                    ⏱ Ready in {formatSeconds(secondsLeft)}
                  </div>
                )}

                {/* Info hint - no action button on status page */}
                <div className="mt-1 text-sm text-red-400 font-medium flex items-center gap-1 group-hover:text-red-300">
                  View details &amp; commit on dedicated page →
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {(!hideHeader || crimes.length > 1) && (
        <div className="text-center text-sm text-zinc-500 pt-4">
          Click any crime above to go to its standalone page where you can commit.
        </div>
      )}
    </div>
  );
}
