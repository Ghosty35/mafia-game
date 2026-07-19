'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash, formatSeconds } from '@/lib/format';
import { streetEventText } from '@/lib/streetEvents';
import { usePlayer } from '../../components/PlayerContext';
import { useActionLock, isTooFastError } from '../../components/useActionLock';
import type { Crime, Player, CrimeResult } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n/translations';

export default function SingleCrimeClient({
  initialPlayer,
  crime,
  initialCooldowns,
}: {
  initialPlayer: Player | null;
  crime: Crime;
  initialCooldowns: { crime_key: string; available_at: string }[];
}) {
  const { t, language } = useLanguage();
  const { updatePlayer, refreshPlayer, showToast } = usePlayer();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(initialPlayer);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialCooldowns.map((row) => [row.crime_key, Date.parse(row.available_at)])
    )
  );
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const { guard, locked: actionLocked } = useActionLock();

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!player) {
    return <div className="p-8">Could not load player data.</div>;
  }

  const availableAt = cooldowns[crime.key] ?? 0;
  const secondsLeft = Math.max(0, Math.ceil((availableAt - now) / 1000));
  const coolingDown = secondsLeft > 0;
  const locked = player.level < crime.min_level;
  const inJail = player.jailed_until && new Date(player.jailed_until).getTime() > now;
  const heat = player.heat || 0;
  const disabled = locked || coolingDown || inJail || busy || actionLocked;

  // Remaining time comes from the server (available_at), not a client
  // recomputation, so it matches what commit_crime enforces.
  const effectiveCooldown = crime.cooldown_seconds;

  const doSingleCrime = async () => {
    // Client-side anti-autoclick backstop (server also enforces TOO_FAST).
    if (guard()) return;

    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('commit_crime', {
      crime_key: crime.key,
    });
    setBusy(false);

    if (error) {
      let text = t('error_generic');
      if (isTooFastError(error.message)) text = t('error_too_fast');
      else if (error.message.includes('ON_COOLDOWN')) text = t('error_on_cooldown');
      else if (error.message.includes('IN_JAIL')) text = t('error_in_jail');
      else if (error.message.includes('LEVEL_TOO_LOW')) text = t('error_level_too_low');
      else if (error.message.includes('NOT_ENOUGH_STAMINA')) text = t('error_no_stamina');
      showToast(text, 'error');
      return;
    }

    const res = data as CrimeResult;
    setPlayer(res.player);
    updatePlayer(res.player);
    setCooldowns((prev) => ({ ...prev, [crime.key]: Date.parse(res.available_at) }));
    if (refreshPlayer) await refreshPlayer();
    router.refresh();

    let baseText = res.success
      ? t('crime_result_success').replace('{cash}', formatCash(res.reward, language)).replace('{xp}', String(res.xp_gained))
      : t('crime_result_fail');

    if (res.murder_skill_gained) {
      baseText += ` • +${res.murder_skill_gained} KillSkill`;
    }
    if (res.health_lost) {
      baseText += ` • -${res.health_lost} Health`;
    }

    if (res.in_family && res.family_respect_gained && res.family_respect_gained > 0) {
      baseText += ` • +${res.family_respect_gained} Family Respect`;
    }

    // Random street event (071)
    const evText = streetEventText((res as unknown as { event: string }).event, t, language);
    if (evText) baseText += ` • ${evText}`;

    if (res.leveled_up) {
      showToast(baseText + ' ' + t('crime_level_up').replace('{level}', String(res.player.level)), 'levelup');
    } else {
      showToast(baseText, res.success ? 'success' : 'fail');
    }
  };

  // Player's "achieved" % for this crime: show the crime's success chance as the base, and cooldown status
  const successPercent = Math.round(crime.success_chance * 100);
  const cooldownPercent = coolingDown ? Math.round((secondsLeft / effectiveCooldown) * 100) : 0;

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <Link href="/crimes" className="text-sm text-red-400 hover:underline">← Back to Crime Selection</Link>
      </div>

      <div className="card bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-lg">{t(`crime_${crime.key}` as TranslationKey)}</h3>
          <span className="text-sm text-zinc-400 whitespace-nowrap">⏱ {coolingDown ? `${formatSeconds(secondsLeft)} left` : formatSeconds(effectiveCooldown)}</span>
        </div>
        <p className="text-sm text-zinc-500 mb-3">{t(`crime_${crime.key}_desc` as TranslationKey)}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400 mb-4">
          <span>
            Reward: <span className="text-green-400">{formatCash(crime.min_reward, language)}–{formatCash(crime.max_reward, language)}</span>
          </span>
          <span>
            Success Rate: <span className="text-white">{successPercent}%</span>
          </span>
        </div>

        {locked && (
          <p className="text-sm font-semibold text-zinc-500 mb-3">🔒 Unlocks at level {crime.min_level}</p>
        )}

        {!locked && (
          <button
            onClick={doSingleCrime}
            disabled={disabled}
            className={`w-full py-2.5 rounded-lg font-bold transition-all active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed ${
              coolingDown ? 'bg-zinc-800 text-zinc-400' : 'bg-red-700 hover:bg-red-600 text-white'
            }`}
          >
            {busy
              ? t('loading')
              : coolingDown
              ? `⏱ ${t('crime_ready_in')} ${formatSeconds(secondsLeft)}`
              : t('crime_commit')}
          </button>
        )}

        {coolingDown && !locked && (
          <div className="mt-2 text-xs text-zinc-500">
            Your cooldown for this crime: {formatSeconds(secondsLeft)} remaining ({cooldownPercent}% of total)
          </div>
        )}

        {inJail && (
          <p className="mt-2 text-sm text-orange-300">You are currently in jail.</p>
        )}

        {heat > 30 && (
          <p className="mt-2 text-xs text-red-400">⚠️ High heat ({heat}) — Police may raid you on this job.</p>
        )}
      </div>

      <div className="mt-4 text-xs text-zinc-500 text-center">
        This is your dedicated page for <strong>{t(`crime_${crime.key}` as TranslationKey)}</strong>. Success rate: {successPercent}%. 
        {coolingDown && ` Current cooldown: ${formatSeconds(secondsLeft)}.`}
      </div>
    </div>
  );
}
