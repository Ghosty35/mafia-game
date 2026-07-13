'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { formatCash, formatSeconds } from '@/lib/format';
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
}: {
  crimes: Crime[];
  player: Player;
  inJail: boolean;
  nowMs: number;
  cooldowns: Record<string, number>;
  onCooldownUpdate: (crimeKey: string, availableAtMs: number) => void;
  onPlayerUpdate: (p: Player) => void;
}) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ResultBanner | null>(null);

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
      }
      setResult({ kind: 'error', text });
      return;
    }

    const res = data as CrimeResult;
    onPlayerUpdate(res.player);
    onCooldownUpdate(crimeKey, Date.parse(res.available_at));

    if (res.leveled_up) {
      setResult({
        kind: 'levelup',
        text:
          (res.success
            ? t('crime_result_success')
                .replace('{cash}', formatCash(res.reward, language))
                .replace('{xp}', String(res.xp_gained))
            : t('crime_result_fail').replace('{xp}', String(res.xp_gained))) +
          ' ' +
          t('crime_level_up').replace('{level}', String(res.player.level)),
      });
    } else if (res.success) {
      setResult({
        kind: 'success',
        text: t('crime_result_success')
          .replace('{cash}', formatCash(res.reward, language))
          .replace('{xp}', String(res.xp_gained)),
      });
    } else {
      setResult({
        kind: 'fail',
        text: t('crime_result_fail').replace('{xp}', String(res.xp_gained)),
      });
    }
  };

  const bannerStyles: Record<ResultBanner['kind'], string> = {
    success: 'bg-green-950/60 border-green-800 text-green-300',
    fail: 'bg-red-950/60 border-red-800 text-red-300',
    levelup: 'bg-yellow-950/60 border-yellow-700 text-yellow-300 animate-pulse',
    error: 'bg-zinc-800 border-zinc-700 text-zinc-300',
  };

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">🔫 {t('crimes_title')}</h2>

      {result && (
        <p
          className={`border rounded-lg px-4 py-3 mb-4 font-semibold ${bannerStyles[result.kind]}`}
        >
          {result.text}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-5 ${
                locked ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-bold text-lg">
                  {t(`crime_${crime.key}` as TranslationKey)}
                </h3>
                <span className="text-sm text-zinc-400 whitespace-nowrap">
                  ⏱ {formatSeconds(effectiveCooldown)}
                </span>
              </div>
              <p className="text-sm text-zinc-500 mb-3">
                {t(`crime_${crime.key}_desc` as TranslationKey)}
              </p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400 mb-4">
                <span>
                  {t('crime_reward')}:{' '}
                  <span className="text-green-400">
                    {formatCash(crime.min_reward, language)}–
                    {formatCash(crime.max_reward, language)}
                  </span>
                </span>
                <span>
                  {t('crime_success_rate')}:{' '}
                  <span className="text-white">
                    {Math.round(crime.success_chance * 100)}%
                  </span>
                </span>
              </div>

              {locked ? (
                <p className="text-sm font-semibold text-zinc-500">
                  🔒 {t('crime_unlocks_at')} {crime.min_level}
                </p>
              ) : (
                <button
                  onClick={() => doCrime(crime.key)}
                  disabled={disabled}
                  className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed py-2.5 rounded-lg font-bold transition-colors"
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
