'use client';

import { useState, useEffect } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';

type Inmate = { username: string; city: string; level: number; minutes_left: number };

export default function JailPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language } = useLanguage();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [inmates, setInmates] = useState<Inmate[]>([]);
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });
  const breakoutSkill = player?.breakout_skill ?? 10;

  useEffect(() => {
    if (!player?.jailed_until) return;

    const tick = () => {
      const jailTime = new Date(player.jailed_until!).getTime();
      const now = Date.now();
      const diff = Math.max(0, jailTime - now);
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft({ h, m, s });

      if (diff <= 0) {
        window.location.href = '/dashboard';
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [player?.jailed_until]);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data } = await supabase.rpc('get_jailed_players');
      setInmates(Array.isArray(data) ? (data as Inmate[]) : []);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [player?.jailed_until]);

  const trainBreakout = async () => {
    if (!player) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('train_breakout');
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('jail_train_no_cash')
          : error.message || t('jail_train_failed'),
      );
      return;
    }
    const newSkill = data?.breakout_skill ?? breakoutSkill;
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(t('jail_train_success', { skill: newSkill }));
  };

  const attemptBreakout = async () => {
    if (!player?.jailed_until) {
      setMessage(t('jail_not_in_jail'));
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc('attempt_breakout');
    if (error) {
      if (error.message.includes('BREAKOUT_COOLDOWN')) {
        setMessage(t('jail_breakout_cooldown', { minutes: 1 }));
      } else if (error.message.includes('NOT_ENOUGH_CASH')) {
        setMessage(t('jail_train_no_cash'));
      } else {
        setMessage(error.message || t('jail_breakout_error'));
      }
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(
      data?.success
        ? t('jail_breakout_success')
        : t('jail_breakout_failed', { chance: data?.chance ?? 0 }),
    );
  };

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-2">🔒 {t('jail_title')}</h1>
      <p className="text-sm text-zinc-400 mb-4">{t('jail_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 rounded">{message}</div>}

      <div className="bg-zinc-900 border border-orange-900/50 rounded-2xl p-6 mb-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-orange-400 mb-2">Release in</p>
           <div className="flex items-center justify-center gap-2 text-2xl lg:text-4xl font-mono font-bold text-orange-400">
            <span>{pad(timeLeft.h)}</span>
            <span className="text-orange-600 animate-pulse">:</span>
            <span>{pad(timeLeft.m)}</span>
            <span className="text-orange-600 animate-pulse">:</span>
            <span>{pad(timeLeft.s)}</span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">HH : MM : SS</p>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">{t('jail_inmates')} ({inmates.length})</h3>
        {inmates.length === 0 ? (
          <div className="text-sm text-zinc-500">{t('jail_empty')}</div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {inmates.map((j, idx) => (
              <div key={idx} className="text-sm flex justify-between">
                <span>
                  {j.username}{' '}
                  <span className="text-xs text-zinc-500">{t('jail_lvl_city', { level: j.level, city: j.city })}</span>
                </span>
                <span className="font-mono text-orange-400">{t('jail_minutes_left', { minutes: j.minutes_left })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">{t('jail_training_title')}</h3>
        <div>
          {t('jail_skill')}: {breakoutSkill}%
        </div>
        <button
          onClick={trainBreakout}
          disabled={breakoutSkill >= 100}
          className="mt-2 px-4 py-1 bg-blue-700 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('jail_train_button', { cost: formatCash(500, language) })}
        </button>
        {breakoutSkill >= 100 && (
          <p className="text-xs text-zinc-500 mt-1">Max skill reached</p>
        )}
        {player?.jailed_until && (
          <button onClick={attemptBreakout} className="ml-2 px-4 py-1 bg-red-700 rounded text-sm">
            {t('jail_attempt_breakout', { cost: formatCash(2000, language) })}
          </button>
        )}
      </div>
    </div>
  );
}
