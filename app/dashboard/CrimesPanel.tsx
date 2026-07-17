'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { formatCash, formatSeconds } from '@/lib/format';
import { streetEventText } from '@/lib/streetEvents';
import type { Crime, CrimeResult, Player } from '@/lib/types';

type ResultBanner = {
  kind: 'success' | 'fail' | 'levelup' | 'error';
  text: string;
};

export default function CrimesPanel({
  crimes,
  player,
  inJail,
  nowMs,
  cooldowns,
  onCooldownUpdate,
  onPlayerUpdate,
  hideHeader = false,
}: {
  crimes: Crime[];
  player: Player;
  inJail: boolean;
  nowMs: number;
  cooldowns: Record<string, number>;
  onCooldownUpdate: (crimeKey: string, availableAtMs: number) => void;
  onPlayerUpdate: (p: Player) => void;
  hideHeader?: boolean;
}) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ResultBanner | null>(null);

  // Per-crime player stats for live updater (tries, wins, total earnings for that job)
  const [crimeStats, setCrimeStats] = useState<Record<string, { tries: number; wins: number; earnings: number }>>({});

  // VIP rebirth perk: -10% cooldown per rebirth, capped at -50%
  const cooldownMult = 1 - Math.min(player.rebirths * 0.1, 0.5);

  const doCrime = async (crimeKey: string) => {
    setBusy(crimeKey);
    setResult(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('commit_crime', {
      crime_key: crimeKey,
    });
    setBusy(null);

    if (error) {
      let text = t('error_generic');
      if (error.message.includes('ON_COOLDOWN')) {
        text = t('error_on_cooldown');
      } else if (error.message.includes('IN_JAIL')) {
        text = t('error_in_jail');
      } else if (error.message.includes('LEVEL_TOO_LOW')) {
        text = t('error_level_too_low');
      } else if (error.message.includes('NOT_ENOUGH_STAMINA')) {
        text = t('error_no_stamina');
      }
      setResult({ kind: 'error', text });
      return;
    }

    const res = data as CrimeResult;
    onPlayerUpdate(res.player);
    onCooldownUpdate(crimeKey, Date.parse(res.available_at));

    // Update per-crime stats live
    setCrimeStats(prev => {
      const prevStats = prev[crimeKey] || { tries: 0, wins: 0, earnings: 0 };
      const newTries = prevStats.tries + 1;
      const newWins = prevStats.wins + (res.success ? 1 : 0);
      const newEarnings = prevStats.earnings + (res.success ? res.reward : 0);
      return { ...prev, [crimeKey]: { tries: newTries, wins: newWins, earnings: newEarnings } };
    });

    let baseText = res.success
      ? t('crime_result_success')
          .replace('{cash}', formatCash(res.reward, language))
          .replace('{xp}', String(res.xp_gained))
      : t('crime_result_fail');

    if ((res as any).murder_skill_gained) {
      baseText += ` • +${(res as any).murder_skill_gained} KillSkill`;
    }
    if ((res as any).health_lost) {
      baseText += ` • -${(res as any).health_lost} Health`;
    }

    // Show family respect gain (makes being in a family feel valuable)
    if (res.in_family && res.family_respect_gained && res.family_respect_gained > 0) {
      baseText += `  •  +${res.family_respect_gained} Family Respect`;
    }

    // Random street event (071)
    const evText = streetEventText((res as any).event, t, language);
    if (evText) baseText += `  •  ${evText}`;

    if (res.leveled_up) {
      setResult({
        kind: 'levelup',
        text: baseText + ' ' + t('crime_level_up').replace('{level}', String(res.player.level)),
      });
    } else {
      setResult({
        kind: res.success ? 'success' : 'fail',
        text: baseText,
      });
    }
  };

  const bannerStyles: Record<ResultBanner['kind'], string> = {
    success: 'bg-green-950/60 border-green-800 text-green-300',
    fail: 'bg-red-950/60 border-red-800 text-red-300',
    levelup: 'bg-yellow-950/70 border-yellow-600 text-yellow-300 level-up ring-1 ring-yellow-600/50',
    error: 'bg-zinc-800 border-zinc-700 text-zinc-300',
  };

  return (
    <section>
      {!hideHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold tracking-tight">🔫 {t('crimes_title')}</h2>
          <span className="text-xs text-zinc-500">Risk • Reward • Cooldowns</span>
        </div>
      )}

      {result && (
        <p
          className={`result-banner border rounded-xl px-4 py-2 mb-3 text-sm font-medium ${bannerStyles[result.kind]}`}
        >
          {result.text}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {crimes.map((crime) => {
          const locked = player.level < crime.min_level;
          const availableAt = cooldowns[crime.key] ?? 0;
          const secondsLeft = Math.max(0, Math.ceil((availableAt - nowMs) / 1000));
          const coolingDown = secondsLeft > 0;
          const disabled = locked || coolingDown || inJail || busy !== null;
          const effectiveCooldown = Math.round(
            crime.cooldown_seconds * cooldownMult
          );

          return (
            <div
              key={crime.key}
              className={`crime-card bg-zinc-900 border border-zinc-800 transition-all hover:border-zinc-700 ${
                locked ? 'opacity-60' : 'hover:-translate-y-px'
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
                {locked && (
                  <span className="ml-auto text-amber-400/80 font-medium">🔒 Lvl {crime.min_level}</span>
                )}
              </div>

              {/* Player stats for this job - live updater */}
              {(() => {
                const stats = crimeStats[crime.key] || { tries: 0, wins: 0, earnings: 0 };
                const winRate = stats.tries > 0 ? Math.round((stats.wins / stats.tries) * 100) : 0;
                return (
                  <div className="text-xs text-zinc-400 mb-2">
                    Your stats for this job: {stats.tries} tries ({stats.wins} wins / {stats.tries - stats.wins} losses, {winRate}% success) • Total earned: {formatCash(stats.earnings, language)}
                  </div>
                );
              })()}

              {!locked && (
                <button
                  onClick={() => doCrime(crime.key)}
                  disabled={disabled}
                  className={`w-full py-2 rounded-lg text-sm font-bold transition-all active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed ${
                    coolingDown 
                      ? 'bg-zinc-800 text-zinc-400' 
                      : 'btn-primary btn-danger hover:bg-red-600'
                  }`}
                >
                  {busy === crime.key
                    ? t('loading')
                    : coolingDown
                      ? `⏱ ${t('crime_ready_in')} ${formatSeconds(secondsLeft)}`
                      : t('crime_commit')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
