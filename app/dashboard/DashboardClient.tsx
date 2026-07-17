'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';
import UsernamePrompt from './UsernamePrompt';
import LiveLogs from '../components/LiveLogs';
import HeatManager from '../components/HeatManager';
import MostWantedBoard from '../components/MostWantedBoard';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';


export default function DashboardClient({
  email,
  initialPlayer,
  familyStatus,
  playerError,
}: {
  email: string;
  initialPlayer: Player | null;
  familyStatus?: {
    family_id: string | null;
    family_name: string | null;
    family_tag: string | null;
    family_respect: number | null;
    my_role: string | null;
  } | null;
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
    if (contextPlayer) setPlayer(contextPlayer);
  }, [contextPlayer]);

  // Real, live server stats for the hub (there is no season/round system — the
  // old panel showed a hardcoded 2026 progress bar that meant nothing).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data } = await supabase.rpc('get_server_stats');
      if (alive && data) setServerStats(data);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
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

      {/* Front Page - live server stats + clocks */}
      <div className="card p-6 bg-zinc-900 border border-red-900/50">
        <h2 className="text-2xl font-bold mb-4">🏠 {t('hub_title')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="font-semibold text-red-400 mb-2">{t('hub_server')}</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t('status_online'), value: serverStats ? serverStats.online_people.toLocaleString() : '—', color: 'text-emerald-400' },
                { label: t('status_registered'), value: serverStats ? serverStats.people_registered.toLocaleString() : '—', color: 'text-white' },
                { label: t('status_families'), value: serverStats ? serverStats.total_families.toLocaleString() : '—', color: 'text-amber-400' },
                { label: t('status_money'), value: serverStats ? fm(serverStats.total_money_circulation) : '—', color: 'text-emerald-400' },
              ].map((s, i) => (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
                  <div className={`font-mono font-semibold tabular-nums ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <Link href="/server-status" className="inline-block mt-2 text-xs text-red-400 hover:underline">{t('menu_server_status')} →</Link>
          </div>
          <div>
            <div className="font-semibold text-red-400 mb-2">{t('hub_clocks')}</div>
            <div className="font-mono mt-1">{serverTimes.europe}</div>
            <div className="font-mono">{serverTimes.us}</div>
            <div className="text-xs text-zinc-500 mt-2">{t('hub_clocks_note')}</div>
          </div>
        </div>
      </div>

      {player.jailed_until && new Date(player.jailed_until).getTime() > now && (
        <div className="card bg-orange-950/60 border-orange-800 p-4">
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
            className="mt-3 text-sm bg-orange-600 hover:bg-orange-500 px-4 py-1.5 rounded font-semibold"
          >
            Attempt Breakout (costs cash)
          </button>
        </div>
      )}

      {/* Hero Welcome */}
      <div className="text-center py-6">
        <div className="inline-flex items-center gap-2 bg-red-950/50 text-red-400 px-4 py-1 rounded-full text-xs font-semibold tracking-widest mb-3">
          MAFIA GAME 2026
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-2">
          Welcome back, <span className="text-white">{player.username ?? 'Boss'}</span>
        </h1>
        <p className="text-xl text-zinc-400 max-w-md mx-auto">
          The city is yours to take. But first — get up to speed.
        </p>
        <div className="mt-3 text-xs">
          Heat: <span className="font-mono text-red-400">{player.heat ?? 0}</span>/100 
          { (player.heat ?? 0) > 40 && <span className="text-orange-400 ml-1">(Police watching)</span> }
        </div>
      </div>

      {/* === HOME PAGE CONTENT === */}

      {/* Heat management — passive decay, cool-down items, corrupt lawyer */}
      <HeatManager variant="full" />

      {/* Live server activity feed + Most Wanted preview */}
      <section className="grid md:grid-cols-2 gap-4">
        <LiveLogs />
        <div>
          <MostWantedBoard limit={8} compact />
          <div className="mt-2 text-right">
            <Link href="/most-wanted" className="text-xs text-red-400 hover:underline">
              {t('mw_full_board')}
            </Link>
          </div>
        </div>
      </section>

      {/* About the Game */}
      <section>
        <h2 className="text-xl font-bold mb-3">🎯 About the Game</h2>
        <div className="card p-5 text-sm leading-relaxed text-zinc-300">
          Mafia Game is a modern take on classic browser mafia games. 
          Rise through the ranks by committing crimes, building your reputation, and most importantly — 
          joining or creating a powerful Family. 
          The strongest Families don’t just survive… they rule the city.
        </div>
      </section>

      {/* Game Rules & Important Info */}
      <section>
        <h2 className="text-xl font-bold mb-3">📜 Game Rules &amp; Guidelines</h2>
        <div className="card p-5 space-y-4 text-sm">
          <div>
            <div className="font-semibold text-red-400 mb-1">1. Play Fair</div>
            <p className="text-zinc-400">No multi-accounting, bots, or exploiting. We want a fair playing field for everyone.</p>
          </div>
          <div>
            <div className="font-semibold text-red-400 mb-1">2. Respect Other Players</div>
            <p className="text-zinc-400">Trash talk is part of the mafia vibe, but keep it in-game and fun. No real-life harassment or toxicity.</p>
          </div>
          <div>
            <div className="font-semibold text-red-400 mb-1">3. Family First</div>
            <p className="text-zinc-400">Be loyal to your Family. Betrayal can be fun, but only when it’s part of the game — not griefing.</p>
          </div>
          <div>
            <div className="font-semibold text-red-400 mb-1">4. Help New Players</div>
            <p className="text-zinc-400">Everyone started somewhere. Be patient and welcoming. A friendly community keeps the game alive.</p>
          </div>
          <div>
            <div className="font-semibold text-red-400 mb-1">5. Have Fun &amp; Stay Cozy</div>
            <p className="text-zinc-400">This game is meant to be enjoyable together. Celebrate wins, help each other grow, and keep the vibe gezellig.</p>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section>
        <h2 className="text-xl font-bold mb-3">🎮 Get Started</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/crimes" className="card p-5 hover:border-red-700 transition block">
            <div className="text-2xl mb-2">🔫</div>
            <div className="font-semibold">Commit Crimes</div>
            <div className="text-xs text-zinc-500 mt-1">Earn cash, XP and build your name.</div>
          </Link>
          <Link href="/families" className="card p-5 hover:border-red-700 transition block">
            <div className="text-2xl mb-2">👥</div>
            <div className="font-semibold">My Family</div>
            <div className="text-xs text-zinc-500 mt-1">Manage your family and members.</div>
          </Link>
          <Link href="/families?tab=banking" className="card p-5 hover:border-red-700 transition block">
            <div className="text-2xl mb-2">💰</div>
            <div className="font-semibold">Family Donation Bank</div>
            <div className="text-xs text-zinc-500 mt-1">Donate to boost family power & rank.</div>
          </Link>
          <Link href="/bank" className="card p-5 hover:border-red-700 transition block">
            <div className="text-2xl mb-2">🏦</div>
            <div className="font-semibold">Personal Banking</div>
            <div className="text-xs text-zinc-500 mt-1">Deposit & manage your own funds.</div>
          </Link>
        </div>
      </section>

      <div className="text-center text-xs text-zinc-600 pt-2">
        Questions? Talk to your Family or check the rules above. Have fun out there, Boss.
      </div>

      {/* Additional useful info to show everything */}
      <section>
        <h2 className="text-xl font-bold mb-3">📊 Current Stats & Timers</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-sm">Health: {player.health ?? 100}%</div>
            <div className="text-sm">Heat: {player.heat ?? 0}/100</div>
            <div className="text-sm">KillSkill: {(player.murder_skill ?? 0).toFixed(2)}</div>
            <div className="text-sm">Bullets: {player.bullets ?? 0}</div>
            <div className="text-sm">Power: {player.power ?? 0}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm">Bank: {fm(player.personal_bank ?? 0)}</div>
            <div className="text-sm">Weed KGs: {player.drug_storage?.Weed ?? 0}</div>
            <div className="text-sm">Coke KGs: {player.drug_storage?.Coke ?? 0}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm">Current City: {player.current_city ?? 'New York'}</div>
            <div className="text-sm">Owned Properties: {(player.owned_properties || []).length}</div>
            <div className="text-sm">Money Rank: {player.money_rank ?? 'Hobo'}</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">📰 Updates & Upcomings (Page 1/3)</h2>
        <div className="card p-5">
          <ul className="text-sm space-y-1">
            <li>• New dual sidebars (left: crimes, right: family/murder)</li>
            <li>• Death system with 60min lock and 1% respawn</li>
            <li>• Live trackers for cooldowns, weed, etc.</li>
            <li>• Property management with bills and autopay</li>
            <li>• Drug economies with profitable runs</li>
            <li>• Weed growing with progress and raid risk</li>
            <li>• Full murder with rank and skill thresholds</li>
            <li>• Garage with warehouse upgrades and racing</li>
            <li>• Marketplace with bidding and instant buy</li>
            <li>• More coming: casino, stock market heist, tax fund</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">📜 More Details (Page 2/3)</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-semibold">Current Cooldowns</h3>
            <div className="text-xs">See LiveTracker above for live timers</div>
            <div className="text-xs">Crimes: check dedicated pages</div>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold">Important Stats</h3>
            <div className="text-xs">Health decreases on crimes (5-15% on fail in big jobs)</div>
            <div className="text-xs">Use protection and hospital to recover</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">🚀 Upcomings (Page 3/3)</h2>
        <div className="card p-5">
          <ul className="text-sm space-y-1">
            <li>• Casino system</li>
            <li>• Dynamic stock market</li>
            <li>• Tax fund heist (big payout)</li>
            <li>• More cities and drug routes</li>
            <li>• Full property management and passive income</li>
            <li>• Racing with pinkslips and bets</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
