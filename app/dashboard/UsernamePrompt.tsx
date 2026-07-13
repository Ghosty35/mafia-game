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
  const [success, setSuccess] = useState(false);

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

    // Brief success celebration before the dashboard re-renders and hides the prompt
    setSuccess(true);
    setTimeout(() => {
      onClaimed(data as Player);
    }, 650);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-8 shadow-2xl shadow-black/60">
        <h2 className="text-2xl font-bold mb-2">🕶️ {t('username_title')}</h2>
        <p className="text-zinc-400 mb-6">{t('username_desc')}</p>

        {success ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-lg font-semibold text-green-400">
              Gangster name claimed!
            </p>
            <p className="text-sm text-zinc-500 mt-1">Welcome to the family...</p>
          </div>
        ) : (
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
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 focus:outline-none focus:border-red-700 focus:ring-2 focus:ring-red-900/50"
                placeholder="TonySoprano"
                autoFocus
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
              disabled={busy || !name.trim()}
              className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all active:scale-[0.985]"
            >
              {busy ? t('loading') : t('username_claim')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
