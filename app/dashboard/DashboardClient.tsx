'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';
import UsernamePrompt from './UsernamePrompt';
import WelcomeModal from './WelcomeModal';
import LiveLogs from '../components/LiveLogs';
import HeatManager from '../components/HeatManager';
import MostWantedBoard from '../components/MostWantedBoard';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import PageHeader from '../components/PageHeader';


export default function DashboardClient({
  initialPlayer,
  playerError,
}: {
  initialPlayer: Player | null;
  playerError?: { message?: string } | null;
}) {
  const { t, fm } = useLanguage();
  const { player: contextPlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(initialPlayer);
  const [serverStats, setServerStats] = useState<{
    online_people: number;
    total_families: number;
    people_registered: number;
    total_money_circulation: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [serverTimes, setServerTimes] = useState({ europe: '', us: '' });

  // Keep the local player state in sync with the live PlayerContext. The
  // context auto-refreshes every ~15s, so this makes the dashboard reflect
  // real server values after actions taken elsewhere (crimes, heists, etc.)
  // instead of the frozen SSR snapshot. Local setPlayer() calls (username
  // claim, breakout) still apply; they are superseded once context catches up.
  useEffect(() => {
      if (contextPlayer) {
        setPlayer(contextPlayer);
      }
  }, [contextPlayer]);

  // Real, live server stats for the hub (there is no season/round system — the
  // old panel showed a hardcoded 2026 progress bar that meant nothing).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data } = await supabase.rpc('get_server_stats');
      if (alive && data) {
        setServerStats(data);
      }
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Live server clocks in two timezones
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      // Europe GMT+1
      const europeTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Amsterdam',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(now);
      // US EST GMT-5
      const usTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(now);
      setServerTimes({
        europe: `🇪🇺 GMT+1: ${europeTime}`,
        us: `🇺🇸 EST (GMT-5): ${usTime}`
      });
    };
    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!player) {
    return (
      <div className="p-8">
        <p className="text-red-500">Could not load your player profile.</p>
        {playerError && (
          <pre className="mt-4 text-xs text-red-400 bg-zinc-900 p-4 rounded overflow-auto">
            {JSON.stringify(playerError, null, 2)}
          </pre>
        )}
        <p className="mt-4 text-xs text-zinc-500">Try refreshing the page or opening the browser console (F12) for more details.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {!player.username && <UsernamePrompt onClaimed={setPlayer} />}
      {player.username && <WelcomeModal />}

      {/* Front Page - live server stats + clocks */}
      <div className="bg-zinc-900 border border-amber-900/40 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.04),transparent_50%)]" />
        <div className="relative">
          <h2 className="text-2xl font-bold mb-4 tracking-tight">🏠 {t('hub_title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <div className="font-semibold text-amber-400 mb-2 text-xs uppercase tracking-[3px]">{t('hub_server')}</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: t('status_online'), value: serverStats ? serverStats.online_people.toLocaleString() : '—', color: 'text-emerald-400' },
                  { label: t('status_registered'), value: serverStats ? serverStats.people_registered.toLocaleString() : '—', color: 'text-white' },
                  { label: t('status_families'), value: serverStats ? serverStats.total_families.toLocaleString() : '—', color: 'text-amber-400' },
                  { label: t('status_money'), value: serverStats ? fm(serverStats.total_money_circulation) : '—', color: 'text-emerald-400' },
                ].map((s, i) => (
                  <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{s.label}</div>
                    <div className={`font-mono font-semibold tabular-nums ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>
              <Link href="/server-status" className="inline-block mt-3 text-xs text-amber-400 hover:text-amber-300 transition-colors">{t('menu_server_status')} →</Link>
            </div>
            <div>
              <div className="font-semibold text-amber-400 mb-2 text-xs uppercase tracking-[3px]">{t('hub_clocks')}</div>
              <div className="font-mono mt-1 text-sm">{serverTimes.europe}</div>
              <div className="font-mono text-sm">{serverTimes.us}</div>
              <div className="text-xs text-zinc-500 mt-2">{t('hub_clocks_note')}</div>
            </div>
          </div>
        </div>
      </div>

      {player.jailed_until && new Date(player.jailed_until).getTime() > now && (
        <div className="bg-orange-950/60 border border-orange-800/50 rounded-xl p-5">
          <div className="font-semibold text-orange-400">🚔 You are in jail</div>
          <p className="text-sm text-orange-300 mt-1">You cannot commit crimes or heists until you are released.</p>
          <button
            onClick={async () => {
              const supabase = (await import('@/lib/supabase/client')).createClient();
              const { data } = await supabase.rpc('breakout');
              if (data?.player) {
                setPlayer(data.player);
                if (refreshPlayer) await refreshPlayer();
                router.refresh();
              }
            }}
            className="mt-3 text-sm bg-orange-700 hover:bg-orange-600 px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            Attempt Breakout (costs cash)
          </button>
        </div>
      )}

      {/* Hero Welcome */}
      <PageHeader
        title={`Welcome back, ${player.username ?? 'Boss'}`}
        subtitle="The city is yours to take. But first — get up to speed."
        icon="🏠"
        variant="premium"
        badge={
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>Heat: <span className="font-mono text-red-400 font-bold">{player.heat ?? 0}/100</span></span>
            {(player.heat ?? 0) > 40 && <span className="text-orange-400">(Police watching)</span>}
          </div>
        }
        actions={
          <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono text-amber-400">{serverTimes.europe}</span>
            <span className="text-zinc-700">|</span>
            <span className="font-mono text-amber-400">{serverTimes.us}</span>
          </div>
        }
      />

      {/* === HOME PAGE CONTENT === */}

      {/* Current Stats — surfaced near the top so players see their standings */}
      <section>
        <h2 className="text-xl font-bold mb-3 tracking-tight">📊 Current Stats</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-3">Combat</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">Health</span><span className="font-mono text-emerald-400">{player.health ?? 100}%</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Heat</span><span className="font-mono text-red-400">{player.heat ?? 0}/100</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Power</span><span className="font-mono text-amber-400">{player.power ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Bullets</span><span className="font-mono text-zinc-300">{player.bullets ?? 0}</span></div>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-3">Economy</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">Cash</span><span className="font-mono text-emerald-400">{fm(player.cash ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Bank</span><span className="font-mono text-blue-400">{fm(player.personal_bank ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Weed</span><span className="font-mono text-emerald-400">{(player.drug_storage?.Weed ?? 0)} kg</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Coke</span><span className="font-mono text-zinc-200">{(player.drug_storage?.Coke ?? 0)} kg</span></div>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-3">Status</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">City</span><span className="font-mono text-white">{player.current_city ?? 'New York'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Properties</span><span className="font-mono text-amber-400">{(player.owned_properties || []).length}{(player as any)?.staff_role ? '' : '/11'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Rank</span><span className="font-mono text-red-400">{player.money_rank ?? 'Hobo'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Diamonds</span><span className="font-mono text-amber-300">💎 {player.diamonds ?? 0}</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Heat management — passive decay, cool-down items, corrupt lawyer */}
      <HeatManager variant="full" />

      {/* Live server activity feed + Most Wanted preview */}
      <section className="grid md:grid-cols-2 gap-4">
        <LiveLogs />
        <div>
          <MostWantedBoard limit={8} compact />
          <div className="mt-2 text-right">
            <Link href="/most-wanted" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
              {t('mw_full_board')} →
            </Link>
          </div>
        </div>
      </section>

      {/* About the Game */}
      <section>
        <h2 className="text-xl font-bold mb-3 tracking-tight">🎯 About the Game</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-sm leading-relaxed text-zinc-300">
          Mafia Game is a modern take on classic browser mafia games.
          Rise through the ranks by committing crimes, building your reputation, and most importantly —
          joining or creating a powerful Family.
          The strongest Families don&apos;t just survive… they rule the city.
        </div>
      </section>

      {/* Game Rules & Important Info */}
      <section>
        <h2 className="text-xl font-bold mb-3 tracking-tight">📜 Game Rules &amp; Guidelines</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 text-sm">
          {[
            { title: '1. Play Fair', desc: 'No multi-accounting, bots, or exploiting. We want a fair playing field for everyone.', icon: '⚖️' },
            { title: '2. Respect Other Players', desc: 'Trash talk is part of the mafia vibe, but keep it in-game and fun. No real-life harassment or toxicity.', icon: '🤝' },
            { title: '3. Family First', desc: 'Be loyal to your Family. Betrayal can be fun, but only when it’s part of the game — not griefing.', icon: '👥' },
            { title: '4. Help New Players', desc: 'Everyone started somewhere. Be patient and welcoming. A friendly community keeps the game alive.', icon: '🌱' },
            { title: '5. Have Fun & Stay Cozy', desc: 'This game is meant to be enjoyable together. Celebrate wins, help each other grow.', icon: '🔥' },
          ].map((rule, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-lg shrink-0">{rule.icon}</span>
              <div>
                <div className="font-semibold text-amber-400 mb-0.5">{rule.title}</div>
                <p className="text-zinc-400">{rule.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start */}
      <section>
        <h2 className="text-xl font-bold mb-3 tracking-tight">🎮 Get Started</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { href: '/crimes', icon: '🔫', title: 'Commit Crimes', desc: 'Earn cash, XP and build your name.' },
            { href: '/families', icon: '👥', title: 'My Family', desc: 'Manage your family and members.' },
            { href: '/families?tab=banking', icon: '💰', title: 'Family Donation Bank', desc: 'Donate to boost family power & rank.' },
            { href: '/bank', icon: '🏦', title: 'Personal Banking', desc: 'Deposit & manage your own funds.' },
          ].map((card, i) => (
            <Link key={i} href={card.href} className="group bg-zinc-900 border border-zinc-800 hover:border-amber-700/50 rounded-xl p-5 transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.08)] block">
              <div className="text-2xl mb-3 group-hover:scale-110 transition-transform">{card.icon}</div>
              <div className="font-bold text-sm mb-1">{card.title}</div>
              <div className="text-xs text-zinc-500">{card.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      <div className="text-center text-xs text-zinc-600 pt-2">
        Questions? Talk to your Family or check the rules above. Have fun out there, Boss.
      </div>
    </div>
  );
}
