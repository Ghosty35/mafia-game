'use client';

import { useState, useEffect } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import Link from 'next/link';

type Inmate = { username: string; city: string; level: number; minutes_left: number };

export default function JailPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language } = useLanguage();
  const router = useRouter();
  const [breakoutSkill, setBreakoutSkill] = useState(10);
  const [message, setMessage] = useState('');
  const [inmates, setInmates] = useState<Inmate[]>([]);

  // Sync breakout skill from player when available
  useEffect(() => {
    if (player?.breakout_skill !== undefined) {
      setBreakoutSkill(player.breakout_skill);
    }
  }, [player?.breakout_skill]);

  // Real jail roster (084): who is actually locked up right now.
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
    // Cost + skill increment are enforced server-side by train_breakout().
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
    setBreakoutSkill(newSkill);
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(t('jail_train_success', { skill: newSkill }));
  };

  const attemptBreakout = async () => {
    if (!player?.jailed_until) {
      setMessage(t('jail_not_in_jail'));
      return;
    }
    // Escape roll happens server-side (attempt_breakout RPC)
    const supabase = createClient();
    const { data, error } = await supabase.rpc('attempt_breakout');
    if (error) {
      setMessage(
        error.message.includes('NOT_IN_JAIL')
          ? t('jail_not_in_jail')
          : error.message || t('jail_breakout_error'),
      );
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(
      data?.success
        ? t('jail_breakout_success')
        : t('jail_breakout_failed', { minutes: data?.added_minutes || 5 }),
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🔒 {t('jail_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('jail_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 rounded">{message}</div>}

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">{t('jail_inmates')} ({inmates.length})</h3>
        {inmates.length === 0 ? (
          <div className="text-sm text-zinc-500">{t('jail_empty')}</div>
        ) : (
          inmates.map((j, idx) => (
            <div key={idx} className="text-sm mb-1 flex justify-between">
              <span>
                {j.username}{' '}
                <span className="text-xs text-zinc-500">{t('jail_lvl_city', { level: j.level, city: j.city })}</span>
              </span>
              <span className="font-mono text-orange-400">{t('jail_minutes_left', { minutes: j.minutes_left })}</span>
            </div>
          ))
        )}
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">{t('jail_training_title')}</h3>
        <div>
          {t('jail_skill')}: {breakoutSkill}%
        </div>
        <button onClick={trainBreakout} className="mt-2 px-4 py-1 bg-blue-700 rounded text-sm">
          {t('jail_train_button', { cost: formatCash(500, language) })}
        </button>
        {player?.jailed_until && (
          <button onClick={attemptBreakout} className="ml-2 px-4 py-1 bg-red-700 rounded text-sm">
            {t('jail_attempt_breakout')}
          </button>
        )}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
