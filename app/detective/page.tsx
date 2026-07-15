'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { CITIES } from '@/lib/cities';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function DetectivePage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [targetName, setTargetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const supabase = createClient();

  const requestSearch = async () => {
    if (!player || !targetName.trim()) return;

    setBusy(true);
    setMessage(t('detective_searching_msg'));

    // Simulate 15 min search (in real, use DB timer or cron)
    setTimeout(async () => {
      // Find a random city for demo
      const foundCity = CITIES[Math.floor(Math.random() * CITIES.length)];

      // Send message
      await supabase.from('messages').insert({
        to_player_id: player.id,
        from_player_id: player.id, // system for now
        subject: t('detective_report_subject'),
        body: t('detective_report_body', { target: targetName, city: foundCity }),
      });

      setMessage(t('detective_complete', { target: targetName, city: foundCity }));
      setBusy(false);
    }, 5000); // 5 sec for demo instead of 15 min
  };

  if (!player) return <div>{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🕵️ {t('detective_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('detective_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="card p-6">
        <input
          type="text"
          placeholder={t('detective_placeholder')}
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-2 mb-4"
        />

        <button
          onClick={requestSearch}
          disabled={busy || !targetName.trim()}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold disabled:opacity-50"
        >
          {busy ? t('detective_searching') : t('detective_request')}
        </button>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        {t('detective_footer')}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
