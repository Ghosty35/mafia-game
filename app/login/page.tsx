'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import type { LeaderboardEntry } from '@/lib/types';

type ServerStats = {
  online_now: number;
  logged_in_this_week: number;
  total_families: number;
  total_members: number;
  total_cash_circulation: number;
  people_registered: number;
};

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const supabase = createClient();

  const loadPublicData = async () => {
    setStatsLoading(true);
    try {
      const [{ data: lb }, { data: ss }] = await Promise.all([
        supabase.rpc('get_leaderboard'),
        supabase.rpc('get_server_stats'),
      ]);
      if (lb) setLeaderboard((lb as unknown as LeaderboardEntry[]).slice(0, 8));
      if (ss) setServerStats(ss as ServerStats);
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    const doLoad = async () => {
      await loadPublicData();
    };
    doLoad();
    const poll = setInterval(loadPublicData, 30000);
    return () => clearInterval(poll);
  }, [loadPublicData]);

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

  const inputBase =
    'w-full bg-zinc-950 border border-zinc-700 focus:border-red-700 rounded-xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-900/60 transition';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-zinc-950 relative overflow-hidden">
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>

      {/* ===== ENHANCED BACKGROUNDS ===== */}
      {/* Base noise texture */}
      <div className="absolute inset-0 bg-[radial-gradient(#27272a_0.8px,transparent_1px)] bg-[length:4px_4px] opacity-40" />
      {/* Dark vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-black/80" />
      {/* Red ambient glow top-left */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(185,28,28,0.12)_0%,transparent_45%)]" />
      {/* Dark vignette bottom-right */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_85%,rgba(0,0,0,0.7)_0%,transparent_55%)]" />
      {/* City skyline silhouette */}
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

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4">
        <div className="flex flex-col xl:flex-row items-center justify-center gap-8">
          {/* ===== LEFT: Branding + Updates ===== */}
          <div className="flex-1 max-w-md text-center lg:text-left w-full">
            <Link href="/" className="inline-block mb-6 lg:mb-8">
              <div className="text-5xl lg:text-6xl font-black tracking-[-3px] leading-none">
                <span className="text-red-600">HUSTLER&apos;S</span>
                <br />
                <span className="text-white">WAY</span>
              </div>
              <div className="text-red-500/80 text-sm tracking-[4px] mt-1 font-semibold">{t('auth_est')}</div>
            </Link>

            <div className="text-xl lg:text-2xl font-semibold text-white mb-3 tracking-tight">
              {t('auth_hero_login_1')}
              <br />
              {t('auth_hero_login_2')}
            </div>
            <p className="text-zinc-400 max-w-xs mx-auto lg:mx-0 mb-6 lg:mb-8 text-sm lg:text-base">{t('auth_hero_login_sub')}</p>

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

          {/* ===== MIDDLE: Login Form ===== */}
          <div className="w-full max-w-md">
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="mb-6">
                <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{t('signin_title')}</h1>
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
                    className={inputBase}
                    placeholder="you@crimefamily.com"
                    autoComplete="email"
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
                      className={`${inputBase} pr-12`}
                      autoComplete="current-password"
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

          {/* ===== RIGHT: Leaderboard + Server Info + Discord ===== */}
          <div className="w-full max-w-sm space-y-4 hidden xl:block">
            {/* Server Stats */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 backdrop-blur">
              <div className="uppercase text-[10px] tracking-[2px] text-red-500 font-bold mb-3">SERVER STATUS</div>
              {statsLoading ? (
                <div className="text-zinc-500 text-xs">Loading...</div>
              ) : serverStats ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                    <div className="text-zinc-500 text-[10px]">ONLINE NOW</div>
                    <div className="text-white font-bold font-mono">{serverStats.online_now ?? '—'}</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                    <div className="text-zinc-500 text-[10px]">THIS WEEK</div>
                    <div className="text-white font-bold font-mono">{serverStats.logged_in_this_week ?? '—'}</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                    <div className="text-zinc-500 text-[10px]">REGISTERED</div>
                    <div className="text-white font-bold font-mono">{(serverStats.people_registered ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                    <div className="text-zinc-500 text-[10px]">FAMILIES</div>
                    <div className="text-white font-bold font-mono">{serverStats.total_families ?? '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500 text-xs">Unavailable</div>
              )}
            </div>

            {/* Leaderboard */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 backdrop-blur">
              <div className="uppercase text-[10px] tracking-[2px] text-red-500 font-bold mb-3">{t('auth_leaderboard_title')}</div>
              {leaderboard.length === 0 ? (
                <div className="text-zinc-500 text-xs">No players yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {leaderboard.map((p, i) => (
                    <div key={p.username} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-red-500 font-mono font-bold text-[10px] w-4">#{i + 1}</span>
                        <span className="text-zinc-300 truncate">{p.username}</span>
                      </div>
                      <span className="text-zinc-500 font-mono text-[10px]">Lvl {p.level}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Discord */}
              <a
                href="https://discord.gg/FegBH4DZK"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-indigo-950/30"
              >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
              Join Discord
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
