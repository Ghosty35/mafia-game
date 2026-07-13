'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash, formatSeconds } from '@/lib/format';
import { usePlayer } from '../../components/PlayerContext';
import type { Crime, Player, CrimeResult } from '@/lib/types';

type ResultBanner = {
  kind: 'success' | 'fail' | 'levelup' | 'error';
  text: string;
};

export default function SingleCrimeClient({
  initialPlayer,
  crime,
  initialCooldowns,
  familyStatus,
}: {
  initialPlayer: Player | null;
  crime: Crime;
  initialCooldowns: { crime_key: string; available_at: string }[];
  familyStatus?: any;
}) {
  const { t, language } = useLanguage();
  const { updatePlayer } = usePlayer();
  const [player, setPlayer] = useState<Player | null>(initialPlayer);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialCooldowns.map((row) => [row.crime_key, Date.parse(row.available_at)])
    )
  );
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultBanner | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
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
  const disabled = locked || coolingDown || inJail || busy;

  const effectiveCooldown = Math.round(crime.cooldown_seconds * (1 - Math.min(player.rebirths * 0.1, 0.5)));

  const doSingleCrime = async () => {
    setBusy(true);
    setResult(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('commit_crime', {
      crime_key: crime.key,
    });
    setBusy(false);

    if (error) {
      let text = t('error_generic');
      if (error.message.includes('ON_COOLDOWN')) text = t('error_on_cooldown');
      else if (error.message.includes('IN_JAIL')) text = t('error_in_jail');
      else if (error.message.includes('LEVEL_TOO_LOW')) text = t('error_level_too_low');
      setResult({ kind: 'error', text });
      return;
    }

    const res = data as CrimeResult;
    setPlayer(res.player);
    updatePlayer(res.player);
    setCooldowns((prev) => ({ ...prev, [crime.key]: Date.parse(res.available_at) }));

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

    if (res.leveled_up) {
      setResult({ kind: 'levelup', text: baseText + ' ' + t('crime_level_up').replace('{level}', String(res.player.level)) });
    } else {
      setResult({ kind: res.success ? 'success' : 'fail', text: baseText });
    }
  };

  const bannerStyles: Record<ResultBanner['kind'], string> = {
    success: 'bg-green-950/60 border-green-800 text-green-300',
    fail: 'bg-red-950/60 border-red-800 text-red-300',
    levelup: 'bg-yellow-950/70 border-yellow-600 text-yellow-300 animate-pulse',
    error: 'bg-zinc-800 border-zinc-700 text-zinc-300',
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
          <h3 className="font-bold text-lg">{t(`crime_${crime.key}` as any)}</h3>
          <span className="text-sm text-zinc-400 whitespace-nowrap">⏱ {formatSeconds(effectiveCooldown)}</span>
        </div>
        <p className="text-sm text-zinc-500 mb-3">{t(`crime_${crime.key}_desc` as any)}</p>

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

        {result && (
          <p className={`mt-3 text-sm font-medium p-3 rounded border ${bannerStyles[result.kind]}`}>
            {result.text}
          </p>
        )}

        {inJail && (
          <p className="mt-2 text-sm text-orange-300">You are currently in jail.</p>
        )}

        {heat > 30 && (
          <p className="mt-2 text-xs text-red-400">⚠️ High heat ({heat}) — Police may raid you on this job.</p>
        )}
      </div>

      <div className="mt-4 text-xs text-zinc-500 text-center">
        This is your dedicated page for <strong>{t(`crime_${crime.key}` as any)}</strong>. Success rate: {successPercent}%. 
        {coolingDown && ` Current cooldown: ${formatSeconds(secondsLeft)}.`}
      </div>
    </div>
  );
}
