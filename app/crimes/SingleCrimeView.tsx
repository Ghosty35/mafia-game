'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash, formatSeconds } from '@/lib/format';
import { streetEventText } from '@/lib/streetEvents';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import type { Crime, Player } from '@/lib/types';

type ResultBanner = {
  kind: 'success' | 'fail' | 'levelup' | 'error';
  text: string;
};

export default function SingleCrimeView({ crimeKey }: { crimeKey: string }) {
  const { t, language } = useLanguage();
  const { canPerformAction, recordAction, updatePlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [crime, setCrime] = useState<Crime | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultBanner | null>(null);
  const [crimeStats, setCrimeStats] = useState({ tries: 0, wins: 0, earnings: 0 });

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: p } = await supabase.rpc('get_my_player');
      const { data: cs } = await supabase.from('crimes').select('*');
      const { data: cds } = await supabase.from('crime_cooldowns').select('*');

      const c = (cs as Crime[] || []).find((c: Crime) => c.key === crimeKey);
      if (c) setCrime(c);
      if (p) setPlayer(p as Player);
      if (cds) {
        setCooldowns(Object.fromEntries((cds as any[]).map((row) => [row.crime_key, Date.parse(row.available_at)])));
      }
    };
    load();
  }, [crimeKey]);

  if (!player || !crime) {
    return <div className="p-8">Loading...</div>;
  }

  const availableAt = cooldowns[crime.key] ?? 0;
  const secondsLeft = Math.max(0, Math.ceil((availableAt - now) / 1000));
  const coolingDown = secondsLeft > 0;
  const locked = player.level < crime.min_level;
  const inJail = player.jailed_until && new Date(player.jailed_until).getTime() > now;
  const disabled = locked || coolingDown || inJail || busy;
  let effectiveCooldown = Math.round(crime.cooldown_seconds * (1 - Math.min(player.rebirths * 0.1, 0.5)));
  if (player.is_donator) effectiveCooldown = Math.round(effectiveCooldown * 0.8); // 20% global cooldown reduction for donators

  const doCrime = async () => {
    if (!canPerformAction()) {
      setResult({ kind: 'error', text: 'Please wait 2 seconds between actions.' });
      return;
    }
    recordAction();
    setBusy(true);
    setResult(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('commit_crime', { crime_key: crime.key });
    setBusy(false);

    if (error) {
      let text = error.message || t('error_generic');
      if (error.message.includes('ON_COOLDOWN')) text = t('error_on_cooldown');
      else if (error.message.includes('IN_JAIL')) text = t('error_in_jail');
      else if (error.message.includes('LEVEL_TOO_LOW')) text = t('error_level_too_low');
      else if (error.message.includes('NOT_ENOUGH_STAMINA')) text = t('error_no_stamina');
      setResult({ kind: 'error', text });
      return;
    }

    const res = data as any;
    setPlayer(res.player);
    updatePlayer(res.player);
    setCooldowns(prev => ({ ...prev, [crime.key]: Date.parse(res.available_at) }));
    if (refreshPlayer) await refreshPlayer();
    router.refresh();

    setCrimeStats(prev => {
      const newTries = prev.tries + 1;
      const newWins = prev.wins + (res.success ? 1 : 0);
      const newEarnings = prev.earnings + (res.success ? res.reward : 0);
      return { tries: newTries, wins: newWins, earnings: newEarnings };
    });

    // Dynamic player-based messages for authenticity (varies each time)
    const dynamicMessages = {
      success: [
        "Smooth as silk, you lifted that wallet without a hitch! +{cash} and a quick getaway.",
        "Pickpocket pro! The tourist never saw it coming. {cash} richer and feeling slick.",
        "Nailed it! Their pocket was begging for your fingers. {cash} in the bag, no sweat.",
        "Another victim of your sticky fingers. {cash} harvested, and the streets love you for it."
      ],
      fail: [
        "Busted! They caught you red-handed. Lesson learned the hard way.",
        "Oof, that mark had eyes in the back of their head. Better luck next time, rookie.",
        "Failed grab! They turned around just in time. Next pocket might be luckier.",
        "Pickpocket fail - you fumbled it. The cops are laughing, and so is your empty pocket."
      ]
    };
    const msgList = res.success ? dynamicMessages.success : dynamicMessages.fail;
    const dynamicMsg = msgList[Math.floor(Math.random() * msgList.length)].replace('{cash}', formatCash(res.reward, language));

    let baseText = res.success
      ? dynamicMsg + ` (Base: ${t('crime_result_success').replace('{cash}', formatCash(res.reward, language)).replace('{xp}', String(res.xp_gained))})`
      : dynamicMsg + ` (Base: ${t('crime_result_fail').replace('{xp}', String(res.xp_gained))})`;

    if (res.in_family && res.family_respect_gained) {
      baseText += ` • +${res.family_respect_gained} Family Respect`;
    }

    // Random street event (071)
    const evText = streetEventText(res.event, t, language);
    if (evText) baseText += ` • ${evText}`;
    // Dynamic message for pickpocket already, extend for other crimes if needed (deep dive: vary per action)

    if (res.leveled_up) {
      setResult({ kind: 'levelup', text: baseText + ' ' + t('crime_level_up').replace('{level}', String(res.player.level)) });
    } else {
      setResult({ kind: res.success ? 'success' : 'fail', text: baseText });
    }
  };

  const bannerStyles: Record<string, string> = {
    success: 'bg-green-950/60 border-green-800 text-green-300',
    fail: 'bg-red-950/60 border-red-800 text-red-300',
    levelup: 'bg-yellow-950/70 border-yellow-600 text-yellow-300 animate-pulse',
    error: 'bg-zinc-800 border-zinc-700 text-zinc-300',
  };

  const successPercent = Math.round(crime.success_chance * 100);
  const cooldownPercent = coolingDown ? Math.round((secondsLeft / effectiveCooldown) * 100) : 0;
  const winRate = crimeStats.tries > 0 ? Math.round((crimeStats.wins / crimeStats.tries) * 100) : 0;

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <Link href="/crimes" className="text-sm text-red-400 hover:underline">← Back to Crime Status</Link>
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{t(`crime_${crime.key}` as any)}</h1>
        <p className="text-sm text-zinc-500">{t(`crime_${crime.key}_desc` as any)}</p>
      </div>

      <div className="card bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        {crime.key === 'pickpocket' && (
          <img src="https://picsum.photos/id/1011/300/120" alt="Pickpocket" className="w-full h-24 object-cover rounded mb-3" />
        )}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="font-semibold text-lg">{t(`crime_${crime.key}` as any)}</div>
          </div>
          <span className="text-sm text-zinc-400">⏱ {formatSeconds(effectiveCooldown)}</span>
        </div>

        <div className="flex items-center gap-x-3 text-xs mb-3 text-zinc-400">
          <span className="font-medium text-emerald-400/90">
            {formatCash(crime.min_reward, language)}–{formatCash(crime.max_reward, language)}
          </span>
          <span className="text-zinc-600">•</span>
          <span>{successPercent}% success</span>
          {locked && <span className="ml-auto text-amber-400/80">🔒 Lvl {crime.min_level}</span>}
        </div>

        <div className="text-xs text-zinc-400 mb-3">
          Your stats: {crimeStats.tries} tries ({crimeStats.wins} wins / {crimeStats.tries - crimeStats.wins} losses, {winRate}% ) • Earned: {formatCash(crimeStats.earnings, language)}
        </div>

        {result && <p className={`mb-3 text-sm p-3 rounded border ${bannerStyles[result.kind]}`}>{result.text}</p>}

        {!locked && (
          <button
            onClick={doCrime}
            disabled={disabled}
            className={`w-full py-2.5 rounded-lg font-bold transition-all ${coolingDown ? 'bg-zinc-800 text-zinc-400' : 'bg-red-700 hover:bg-red-600 text-white'} disabled:opacity-50`}
          >
            {busy ? t('loading') : coolingDown ? `⏱ ${t('crime_ready_in')} ${formatSeconds(secondsLeft)}` : t('crime_commit')}
          </button>
        )}

        {coolingDown && <div className="mt-2 text-xs text-zinc-500">Cooldown: {formatSeconds(secondsLeft)} left ({cooldownPercent}%)</div>}

        {inJail &&<p className="mt-2 text-sm text-orange-300">🚔 In jail: {formatSeconds(Math.max(0, Math.ceil((new Date(player.jailed_until!).getTime() - now) / 1000)))}</p>}
      </div>
    </div>
  );
}
