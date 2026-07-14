'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MessagesPage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    if (!player) return;

    const loadMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('to_player_id', player.id)
        .order('created_at', { ascending: false });

      setMessages(data || []);
      setLoading(false);
    };

    loadMessages();
  }, [player?.id]);

  if (!player) return <div className="p-8">{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">📬 {t('messages_title')}</h1>

      {loading && <p>{t('messages_loading')}</p>}

      {messages.length === 0 && !loading && (
        <p className="text-zinc-500">{t('messages_none')}</p>
      )}

      <div className="space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className="card p-4">
            <div className="font-semibold">{msg.subject || t('messages_default_subject')}</div>
            <div className="text-sm text-zinc-400 mt-1">{msg.body}</div>
            <div className="text-xs text-zinc-500 mt-2">
              {new Date(msg.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
