'use client';

import { useState, useEffect } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import Link from 'next/link';

export default function JailPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const router = useRouter();
  const [breakoutSkill, setBreakoutSkill] = useState(10);
  const [message, setMessage] = useState('');

  // Sync breakout skill from player when available
  useEffect(() => {
    if (player?.breakout_skill !== undefined) {
      setBreakoutSkill(player.breakout_skill);
    }
  }, [player?.breakout_skill]);

  const jailedPlayers = [
    { username: 'Rival1', time: '45m', city: 'New York' },
    { username: 'Thief2', time: '20m', city: 'Chicago' },
    // Demo list, in real pull from server
  ];

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
        <h3 className="font-bold mb-2">{t('jail_inmates')}</h3>
        {jailedPlayers.map((j, idx) => (
          <div key={idx} className="text-sm mb-1">
            {j.username} - {t('jail_time_in_city', { time: j.time, city: j.city })}
          </div>
        ))}
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-2">{t('jail_training_title')}</h3>
        <div>
          {t('jail_skill')}: {breakoutSkill}%
        </div>
        <button onClick={trainBreakout} className="mt-2 px-4 py-1 bg-blue-700 rounded text-sm">
          {t('jail_train_button', { cost: formatCash(500) })}
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
