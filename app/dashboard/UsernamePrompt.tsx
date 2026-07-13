'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';

const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;

export default function UsernamePrompt({
  onClaimed,
}: {
  onClaimed: (p: Player) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claim = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!USERNAME_REGEX.test(name)) {
      setError(t('error_username_invalid'));
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('set_username', {
      new_username: name,
    });
    setBusy(false);

    if (error) {
      if (error.message.includes('USERNAME_TAKEN')) {
        setError(t('error_username_taken'));
      } else if (error.message.includes('INVALID_USERNAME')) {
        setError(t('error_username_invalid'));
      } else {
        setError(t('error_generic'));
      }
      return;
    }

    onClaimed(data as Player);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-8">
        <h2 className="text-2xl font-bold mb-2">🕶️ {t('username_title')}</h2>
        <p className="text-zinc-400 mb-6">{t('username_desc')}</p>

        <form onSubmit={claim} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm text-zinc-400 mb-1">
              {t('auth_username')}
            </label>
            <input
              id="username"
              type="text"
              required
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 focus:outline-none focus:border-red-700"
              placeholder="TonySoprano"
            />
            <p className="text-xs text-zinc-600 mt-1">{t('username_rules')}</p>
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-950/50 border border-red-900 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 py-3 rounded-lg font-bold transition-colors"
          >
            {busy ? t('loading') : t('username_claim')}
          </button>
        </form>
      </div>
    </div>
  );
}
