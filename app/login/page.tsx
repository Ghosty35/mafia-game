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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(185,28,28,0.10)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.6)_0%,transparent_60%)]" />
      {/* Living night-city skyline silhouette along the bottom */}
      <div
        className="absolute inset-x-0 bottom-0 h-[42vh] pointer-events-none opacity-90"
        style={{
          backgroundRepeat: 'repeat-x',
          backgroundPosition: 'bottom center',
          backgroundSize: '1200px 300px',
          WebkitMaskImage: 'linear-gradient(to top, #000 55%, transparent 100%)',
          maskImage: 'linear-gradient(to top, #000 55%, transparent 100%)',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='300' viewBox='0 0 1200 300'%3E%3Cg fill='%230c0c12'%3E%3Crect x='0' y='232' width='60' height='68'/%3E%3Crect x='70' y='196' width='44' height='104'/%3E%3Crect x='124' y='150' width='54' height='150'/%3E%3Crect x='188' y='212' width='40' height='88'/%3E%3C/g%3E%3Cg fill='%230f0f17'%3E%3Crect x='236' y='176' width='58' height='124'/%3E%3Crect x='304' y='120' width='46' height='180'/%3E%3Crect x='360' y='206' width='52' height='94'/%3E%3Crect x='422' y='160' width='40' height='140'/%3E%3Crect x='470' y='226' width='60' height='74'/%3E%3C/g%3E%3Cg fill='%230c0c12'%3E%3Crect x='538' y='138' width='50' height='162'/%3E%3Crect x='596' y='198' width='44' height='102'/%3E%3Crect x='648' y='164' width='56' height='136'/%3E%3Crect x='712' y='116' width='42' height='184'/%3E%3Crect x='762' y='210' width='54' height='90'/%3E%3C/g%3E%3Cg fill='%230f0f17'%3E%3Crect x='824' y='172' width='48' height='128'/%3E%3Crect x='880' y='128' width='58' height='172'/%3E%3Crect x='946' y='206' width='40' height='94'/%3E%3Crect x='994' y='156' width='52' height='144'/%3E%3Crect x='1054' y='220' width='46' height='80'/%3E%3C/g%3E%3Cg fill='%230c0c12'%3E%3Crect x='1108' y='188' width='54' height='112'/%3E%3Crect x='1170' y='150' width='42' height='150'/%3E%3C/g%3E%3Cg fill='%23b91c1c'%3E%3Crect x='140' y='168' width='6' height='6'/%3E%3Crect x='154' y='186' width='6' height='6'/%3E%3Crect x='320' y='140' width='6' height='6'/%3E%3Crect x='332' y='170' width='6' height='6'/%3E%3Crect x='724' y='140' width='6' height='6'/%3E%3Crect x='738' y='164' width='6' height='6'/%3E%3Crect x='892' y='150' width='6' height='6'/%3E%3Crect x='908' y='180' width='6' height='6'/%3E%3Crect x='1182' y='170' width='6' height='6'/%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl">
        <div className="flex flex-col lg:flex-row items-center justify-center gap-12">
          {/* Left: Branding + Updates */}
          <div className="flex-1 max-w-md text-center lg:text-left">
            <Link href="/" className="inline-block mb-8">
              <div className="text-6xl font-black tracking-[-3px] leading-none">
                <span className="text-red-600">HUSTLER&apos;S</span><br />
                <span className="text-white">WAY</span>
              </div>
              <div className="text-red-500/80 text-sm tracking-[4px] mt-1 font-semibold">{t('auth_est')}</div>
            </Link>

            <div className="text-2xl font-semibold text-white mb-3 tracking-tight">
              {t('auth_hero_login_1')}<br />{t('auth_hero_login_2')}
            </div>
            <p className="text-zinc-400 max-w-xs mx-auto lg:mx-0 mb-8">
              {t('auth_hero_login_sub')}
            </p>

            {/* "Updates" / What's New Section - makes it feel fresh */}
            <div className="hidden lg:block bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 text-left backdrop-blur">
              <div className="uppercase text-[10px] tracking-[2px] text-red-500 font-bold mb-3">{t('auth_updates_title')}</div>
              <ul className="space-y-2 text-sm text-zinc-300">
                <li className="flex gap-2">• <span><strong>{t('auth_update_1_label')}</strong> — {t('auth_update_1_text')}</span></li>
                <li className="flex gap-2">• <span><strong>{t('auth_update_2_label')}</strong> — {t('auth_update_2_text')}</span></li>
                <li className="flex gap-2">• <span><strong>{t('auth_update_3_label')}</strong> — {t('auth_update_3_text')}</span></li>
                <li className="flex gap-2">• <span><strong>{t('auth_update_4_label')}</strong> — {t('auth_update_4_text')}</span></li>
                <li className="flex gap-2">• <span><strong>{t('auth_update_5_label')}</strong> — {t('auth_update_5_text')}</span></li>
              </ul>
              <div className="text-[10px] text-zinc-500 mt-3">{t('auth_updates_footer')}</div>
            </div>
          </div>

          {/* Right: Login Form */}
          <div className="w-full max-w-md">
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-3xl p-8 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight">{t('signin_title')}</h1>
                <p className="text-zinc-400 text-sm mt-1">{t('auth_welcome_back')}</p>
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
              {t('auth_secure_footer')}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
