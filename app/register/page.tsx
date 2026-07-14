'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

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
    'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 focus:outline-none focus:border-red-700 focus:ring-2 focus:ring-red-900/50';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-950 relative overflow-hidden">
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
      {/* Dramatic Mafia Background Layers (same as login) */}
      <div className="absolute inset-0 bg-[radial-gradient(#27272a_0.8px,transparent_1px)] bg-[length:4px_4px] opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-black/80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(185,28,28,0.08)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.6)_0%,transparent_60%)]" />

      <div className="relative z-10 w-full max-w-5xl">
        <div className="flex flex-col lg:flex-row items-center justify-center gap-12">
          {/* Left branding + updates */}
          <div className="flex-1 max-w-md text-center lg:text-left">
            <Link href="/" className="inline-block mb-8">
              <div className="text-6xl font-black tracking-[-3px] leading-none">
                <span className="text-red-600">MAFIA</span><br />
                <span className="text-white">GAME 2026</span>
              </div>
              <div className="text-red-500/80 text-sm tracking-[4px] mt-1 font-semibold">EST. 2026 • UNDERWORLD EDITION</div>
            </Link>

            <div className="text-2xl font-semibold text-white mb-3 tracking-tight">
              THE CITY IS YOURS<br />TO TAKE.
            </div>
            <p className="text-zinc-400 max-w-xs mx-auto lg:mx-0 mb-8">
              Create your gangster. Build your family. Dominate every system.
            </p>

            <div className="hidden lg:block bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 text-left backdrop-blur">
              <div className="uppercase text-[10px] tracking-[2px] text-red-500 font-bold mb-3">JOIN THE RANKS</div>
              <ul className="space-y-2 text-sm text-zinc-300">
                <li>• Full crime &amp; heist progression</li>
                <li>• Live Stock Market + Casino economy</li>
                <li>• Powerful Families with hourly payouts</li>
                <li>• Properties, Weed, Racing &amp; more</li>
              </ul>
            </div>
          </div>

          {/* Form Card */}
          <div className="w-full max-w-md">
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-3xl p-8 shadow-2xl shadow-black/60 backdrop-blur-xl">
              {checkEmail ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-3">📨</div>
                  <h2 className="text-xl font-bold mb-2 text-green-400">Check your email</h2>
                  <p className="text-zinc-400">{t('register_check_email')}</p>
                  <Link href="/login" className="inline-block mt-6 text-red-500 hover:underline">Back to login</Link>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">{t('register_title')}</h1>
                    <p className="text-zinc-400 text-sm mt-1">One account. Infinite crime.</p>
                  </div>

                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label htmlFor="username" className="block text-sm text-zinc-400 mb-1.5 font-medium">
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
                      <p className="text-xs text-zinc-600 mt-1">{t('username_rules')}</p>
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm text-zinc-400 mb-1.5 font-medium">
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
                      <label htmlFor="password" className="block text-sm text-zinc-400 mb-1.5 font-medium">
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
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-xl text-zinc-500 hover:text-white transition"
                          aria-label="Toggle password visibility"
                        >
                          {showPassword ? '🙈' : '👁️'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="confirmPassword" className="block text-sm text-zinc-400 mb-1.5 font-medium">
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
                      <div className="text-red-400 text-sm bg-red-950/60 border border-red-900/70 rounded-xl px-4 py-3">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full mt-2 bg-red-700 hover:bg-red-600 active:bg-red-800 disabled:opacity-60 text-white py-3.5 rounded-2xl font-bold text-lg tracking-wide transition-all shadow-lg shadow-red-950/50"
                    >
                      {loading ? t('loading') : t('register_button')}
                    </button>
                  </form>

                  <div className="my-6 border-t border-zinc-800" />

                  <p className="text-center text-sm text-zinc-400">
                    {t('register_have_account')}{' '}
                    <Link href="/login" className="text-red-500 hover:text-red-400 font-semibold underline-offset-2 hover:underline">
                      {t('register_signin_link')}
                    </Link>
                  </p>
                </>
              )}
            </div>

            <div className="text-center mt-4 text-[10px] text-zinc-600 tracking-widest">
              YOUR SECRETS ARE SAFE WITH US
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
