'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

// Reusable premium input style for auth screens
const inputBase = "w-full bg-zinc-950 border border-zinc-700 focus:border-red-700 rounded-xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-900/60 transition";

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      if (error.message.includes('Invalid login credentials')) {
        setError(t('error_invalid_credentials'));
      } else {
        setError(error.message);
      }
      return;
    }

    router.push('/dashboard');
    router.refresh();
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-950 relative overflow-hidden">
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
      {/* Dramatic Mafia Background Layers */}
      <div className="absolute inset-0 bg-[radial-gradient(#27272a_0.8px,transparent_1px)] bg-[length:4px_4px] opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-black/80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(185,28,28,0.08)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.6)_0%,transparent_60%)]" />

      <div className="relative z-10 w-full max-w-5xl">
        <div className="flex flex-col lg:flex-row items-center justify-center gap-12">
          {/* Left: Branding + Updates */}
          <div className="flex-1 max-w-md text-center lg:text-left">
            <Link href="/" className="inline-block mb-8">
              <div className="text-6xl font-black tracking-[-3px] leading-none">
                <span className="text-red-600">MAFIA</span><br />
                <span className="text-white">GAME 2026</span>
              </div>
              <div className="text-red-500/80 text-sm tracking-[4px] mt-1 font-semibold">EST. 2026 • UNDERWORLD EDITION</div>
            </Link>

            <div className="text-2xl font-semibold text-white mb-3 tracking-tight">
              RISE FROM THE STREETS.<br />BECOME A LEGEND.
            </div>
            <p className="text-zinc-400 max-w-xs mx-auto lg:mx-0 mb-8">
              The most dangerous and immersive mafia browser game. Build your empire. Control the city.
            </p>

            {/* "Updates" / What's New Section - makes it feel fresh */}
            <div className="hidden lg:block bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 text-left backdrop-blur">
              <div className="uppercase text-[10px] tracking-[2px] text-red-500 font-bold mb-3">LATEST FROM THE STREETS</div>
              <ul className="space-y-2 text-sm text-zinc-300">
                <li className="flex gap-2">• <span><strong>Full Advanced Stock Market</strong> — Trade based on real in-game economy</span></li>
                <li className="flex gap-2">• <span><strong>Revamped Casino</strong> — Real Blackjack &amp; Roulette feeding the pools</span></li>
                <li className="flex gap-2">• <span><strong>Family Boss Tools</strong> — Complete "The Table" management for leaders</span></li>
                <li className="flex gap-2">• <span><strong>Working Admin Panel</strong> — Full control, give, taxes, economy</span></li>
                <li className="flex gap-2">• <span><strong>Rebirth System</strong> — Prestige correctly implemented</span></li>
              </ul>
              <div className="text-[10px] text-zinc-500 mt-3">New content drops weekly. The city never sleeps.</div>
            </div>
          </div>

          {/* Right: Login Form */}
          <div className="w-full max-w-md">
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-3xl p-8 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight">{t('signin_title')}</h1>
                <p className="text-zinc-400 text-sm mt-1">Welcome back, boss. Time to make moves.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
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
                    className="w-full bg-zinc-950 border border-zinc-700 focus:border-red-700 rounded-xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-900/60 transition"
                    placeholder="you@crimefamily.com"
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
                      className="w-full bg-zinc-950 border border-zinc-700 focus:border-red-700 rounded-xl px-4 py-3.5 pr-12 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-900/60 transition"
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
                  {loading ? t('loading') : t('signin_button')}
                </button>
              </form>

              <div className="my-6 border-t border-zinc-800" />

              <p className="text-center text-sm text-zinc-400">
                {t('signin_no_account')}{' '}
                <Link href="/register" className="text-red-500 hover:text-red-400 font-semibold underline-offset-2 hover:underline">
                  {t('signin_register_link')}
                </Link>
              </p>
            </div>

            <div className="text-center mt-4 text-[10px] text-zinc-600 tracking-widest">
              SECURE • ENCRYPTED • NO WITNESSES
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
