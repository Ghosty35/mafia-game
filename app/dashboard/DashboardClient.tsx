'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash, formatSeconds } from '@/lib/format';
import { getRank, getNextRank, GODFATHER_LEVEL } from '@/lib/ranks';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import CrimesPanel from './CrimesPanel';
import RebirthPanel from './RebirthPanel';
import UsernamePrompt from './UsernamePrompt';

// XP needed to reach the next level — season curve, must match
// xp_needed_for_level() in the database (30 * level^1.5)
const xpForNextLevel = (level: number) =>
  Math.floor(30 * level * Math.sqrt(level));

export default function DashboardClient({
  email,
  initialPlayer,
  crimes,
  initialCooldowns,
}: {
  email: string;
  initialPlayer: Player | null;
  crimes: Crime[];
  initialCooldowns: CooldownRow[];
}) {
  const { t, language } = useLanguage();
  const [player, setPlayer] = useState<Player | null>(initialPlayer);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialCooldowns.map((row) => [row.crime_key, Date.parse(row.available_at)])
    )
  );
  const [now, setNow] = useState(() => Date.now());
  const [rebornMessage, setRebornMessage] = useState<string | null>(null);

  // One shared clock tick per second: drives every countdown on screen.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!player) {
    return (
      <main className="flex-1 px-4 py-8 max-w-5xl mx-auto w-full">
        <p className="text-red-500 bg-red-950/50 border border-red-900 rounded-lg px-4 py-3">
          {t('error_load_player')}
        </p>
      </main>
    );
  }

  const jailSecondsLeft = player.jailed_until
    ? Math.max(
        0,
        Math.ceil((new Date(player.jailed_until).getTime() - now) / 1000)
      )
    : 0;
  const inJail = jailSecondsLeft > 0;

  return (
    <main className="flex-1 px-4 py-8 max-w-5xl mx-auto w-full">
      {!player.username && <UsernamePrompt onClaimed={setPlayer} />}

      <header className="mb-8">
        <p className="text-lg text-zinc-400">
          {t('dash_welcome')}{' '}
          <span className="text-white font-semibold">
            {player.username ?? email}
          </span>
          {player.rebirths > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 bg-yellow-950/70 border border-yellow-700 text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full align-middle">
              👑 {t('vip_badge')}
              {player.rebirths > 1 && ` ×${player.rebirths}`}
              <span className="text-yellow-200/80 font-semibold">
                +{player.rebirths * 50}% 💰/XP ·{' '}
                -{Math.min(player.rebirths * 10, 50)}% ⏱
              </span>
            </span>
          )}

          {player.family_id && (
            <Link href="/families" className="ml-3 text-xs bg-red-900/70 hover:bg-red-800 text-red-400 px-2.5 py-0.5 rounded-full align-middle">
              👥 In a Family
            </Link>
          )}
        </p>
      </header>

      {rebornMessage && (
        <div className="bg-gradient-to-r from-yellow-950/70 to-zinc-900 border border-yellow-600 rounded-2xl px-5 py-4 mb-6">
          <p className="font-bold text-yellow-300">👑 {rebornMessage}</p>
        </div>
      )}

      {inJail && (
        <div className="bg-orange-950/60 border border-orange-800 rounded-2xl px-5 py-4 mb-6 flex items-center justify-between">
          <p className="font-bold text-orange-300">🚔 {t('jail_banner')}</p>
          <p className="text-orange-200 font-mono text-lg">
            {t('jail_release_in')} {formatSeconds(jailSecondsLeft)}
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <p className="text-sm text-zinc-500 mb-1">💰 {t('dash_cash')}</p>
          <p className="text-2xl font-bold">
            {formatCash(player.cash, language)}
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <p className="text-sm text-zinc-500 mb-1">💎 {t('dash_diamonds')}</p>
          <p className="text-2xl font-bold mb-1">{player.diamonds}</p>
          <p className="text-xs text-zinc-600">{t('dash_shop_soon')}</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <p className="text-sm text-zinc-500 mb-1">
            ⭐ {t('dash_rank')} · {t('dash_level')} {player.level}
          </p>
          <p className="text-2xl font-bold mb-2 text-red-500">
            {t(getRank(player.level).key)}
          </p>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-600 rounded-full transition-all"
              style={{
                width: `${Math.min(
                  100,
                  (player.xp / xpForNextLevel(player.level)) * 100
                )}%`,
              }}
            />
          </div>
          <p className="text-xs text-zinc-600 mt-1">
            {t('dash_xp')}: {player.xp} / {xpForNextLevel(player.level)}
            {getNextRank(player.level) && (
              <>
                {' · '}
                {t('dash_next_rank')}:{' '}
                {t(getNextRank(player.level)!.key)} ({t('dash_level')}{' '}
                {getNextRank(player.level)!.minLevel})
              </>
            )}
          </p>
        </div>
      </section>

      {player.level >= GODFATHER_LEVEL && (
        <RebirthPanel
          player={player}
          onPlayerUpdate={setPlayer}
          onReborn={setRebornMessage}
        />
      )}

      <CrimesPanel
        crimes={crimes}
        player={player}
        inJail={inJail}
        nowMs={now}
        cooldowns={cooldowns}
        onCooldownUpdate={(crimeKey, availableAtMs) =>
          setCooldowns((prev) => ({ ...prev, [crimeKey]: availableAtMs }))
        }
        onPlayerUpdate={setPlayer}
      />

      <p className="text-zinc-600 text-center italic mt-12">
        {t('dash_coming_soon')}
      </p>
    </main>
  );
}
