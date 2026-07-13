'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;

export default function RegisterPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!USERNAME_REGEX.test(username)) {
      setError(t('error_username_invalid'));
      return;
    }
    if (password.length < 6) {
      setError(t('error_password_short'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('error_password_mismatch'));
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Check name availability before creating the account
    const { data: available } = await supabase.rpc('is_username_available', {
      name: username,
    });
    if (available === false) {
      setLoading(false);
      setError(t('error_username_taken'));
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: { username },
      },
    });

    setLoading(false);

    if (error) {
      if (error.message.includes('already registered')) {
        setError(t('error_user_exists'));
      } else {
        setError(error.message);
      }
      return;
    }

    // Email confirmation enabled -> user must click the link first
    if (data.user && !data.session) {
      setCheckEmail(true);
      return;
    }

    // Email confirmation disabled -> logged in right away
    router.push('/dashboard');
    router.refresh();
  };

  const inputClass =
    'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 focus:outline-none focus:border-red-700 focus:ring-1 focus:ring-red-900';

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="block text-center mb-8">
          <span className="text-3xl font-black tracking-tight">
            <span className="text-red-600">MAFIA</span> GAME
          </span>
        </Link>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl shadow-black/50">
          {checkEmail ? (
            <p className="text-green-400 bg-green-950/50 border border-green-900 rounded-lg px-4 py-3">
              {t('register_check_email')}
            </p>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-6">{t('register_title')}</h1>

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label htmlFor="username" className="block text-sm text-zinc-400 mb-1">
                    {t('auth_username')}
                  </label>
                  <input
                    id="username"
                    type="text"
                    required
                    maxLength={16}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={inputClass}
                    placeholder="TonySoprano"
                  />
                  <p className="text-xs text-zinc-600 mt-1">
                    {t('username_rules')}
                  </p>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm text-zinc-400 mb-1">
                    {t('auth_email')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm text-zinc-400 mb-1">
                    {t('auth_password')}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm text-zinc-400 mb-1">
                    {t('auth_confirm_password')}
                  </label>
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {error && (
                  <p className="text-red-500 text-sm bg-red-950/50 border border-red-900 rounded-lg px-4 py-3">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 py-3 rounded-lg font-bold transition-colors"
                >
                  {loading ? t('loading') : t('register_button')}
                </button>
              </form>

              <p className="text-sm text-zinc-500 mt-6 text-center">
                {t('register_have_account')}{' '}
                <Link href="/login" className="text-red-500 hover:text-red-400 font-semibold">
                  {t('register_signin_link')}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
