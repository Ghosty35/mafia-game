'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';
import UsernamePrompt from './UsernamePrompt';
import LiveLogs from '../components/LiveLogs';
import HeatManager from '../components/HeatManager';


export default function DashboardClient({
  email,
  initialPlayer,
  familyStatus,
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
}) {
  const { t } = useLanguage();
  const [player, setPlayer] = useState<Player | null>(initialPlayer);
  const [serverTimes, setServerTimes] = useState({ europe: '', us: '' });

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

  // Round info (demo - current season, start/end)
  const roundStart = new Date('2026-01-01T00:00:00Z');
  const roundEnd = new Date('2026-12-31T23:59:59Z');
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((roundEnd.getTime() - now.getTime()) / (1000 * 3600 * 24)));
  const roundProgress = Math.min(100, Math.max(0, Math.floor(((now.getTime() - roundStart.getTime()) / (roundEnd.getTime() - roundStart.getTime())) * 100)));

  if (!player) {
    return (
      <div className="p-8">
        <p className="text-red-500">Could not load your player profile.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {!player.username && <UsernamePrompt onClaimed={setPlayer} />}

      {/* Front Page - Game Info, Round, Live Server Clocks */}
      <div className="card p-6 bg-zinc-900 border border-red-900/50">
        <h2 className="text-2xl font-bold mb-4">🏠 Welcome to the Streets - Game Hub</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="font-semibold text-red-400">Current Round / Season</div>
            <div>Season 2026 - "God of the Streets"</div>
            <div>Started: {roundStart.toLocaleDateString()} {roundStart.toLocaleTimeString()}</div>
            <div>Ends: {roundEnd.toLocaleDateString()} {roundEnd.toLocaleTimeString()}</div>
            <div className="mt-1">Time Left: <span className="font-mono text-emerald-400">{daysLeft} days</span></div>
            <div className="mt-1">Progress: <span className="font-mono">{roundProgress}%</span></div>
            <div className="h-2 bg-zinc-800 rounded mt-1">
              <div className="h-2 bg-red-600 rounded" style={{width: `${roundProgress}%`}} />
            </div>
          </div>
          <div>
            <div className="font-semibold text-red-400">Live Server Clocks</div>
            <div className="font-mono mt-1">{serverTimes.europe}</div>
            <div className="font-mono">{serverTimes.us}</div>
            <div className="text-xs text-zinc-500 mt-2">Live synced every second. All trackers (crimes, weed, races, cooldowns) update globally from PlayerContext.</div>
            <div className="mt-2 text-xs">Useful Info: Check sidebars for crimes, family, safehouse. Use travel for city profits. Donators get perks!</div>
          </div>
        </div>
        <div className="mt-4 text-xs text-zinc-400">Home brings you here for round status + live everything. Cooldowns sync across pages.</div>
      </div>

      {player.jailed_until && new Date(player.jailed_until).getTime() > Date.now() && (
        <div className="card bg-orange-950/60 border-orange-800 p-4">
          <div className="font-semibold text-orange-400">🚔 You are in jail</div>
          <p className="text-sm text-orange-300 mt-1">You cannot commit crimes or heists until you are released.</p>
          <button
            onClick={async () => {
              const supabase = (await import('@/lib/supabase/client')).createClient();
              const { data } = await supabase.rpc('breakout');
              if (data?.player) setPlayer(data.player);
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

      {/* Latest News */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold flex items-center gap-2">📰 Latest News</h2>
          <span className="text-xs text-zinc-500">Updated today</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="text-emerald-400 text-xs font-semibold mb-1">NEW</div>
            <h3 className="font-semibold mb-1">Family Bank System Live</h3>
            <p className="text-sm text-zinc-400">
              Families can now collect donations into the Treasury. Managers and Accountants can accept pending donations.
              Stronger families = more power in upcoming wars.
            </p>
          </div>
          <div className="card p-5">
            <div className="text-amber-400 text-xs font-semibold mb-1">UPDATE</div>
            <h3 className="font-semibold mb-1">New Side Navigation</h3>
            <p className="text-sm text-zinc-400">
              We’ve added categorized side menus for faster access to Crimes, Bank, Family and Rankings.
              No more hunting around.
            </p>
          </div>
        </div>
      </section>

      {/* Game Updates */}
      <section>
        <h2 className="text-xl font-bold mb-3">🚀 Game Updates</h2>
        <div className="card p-5 space-y-3 text-sm">
          <div>• <strong>Family Roles Expanded</strong> — Boss, Underboss, Accountant, Managers (max 2), Caporegime and more.</div>
          <div>• <strong>Pending Donations</strong> — Donations now go through approval for better control.</div>
          <div>• <strong>Improved Navigation</strong> — Categorized side menus for quick access.</div>
          <div>• <strong>Next:</strong> Heists, Territory control &amp; Family Wars coming soon.</div>
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
            <div className="text-sm">Bank: ${player.personal_bank ?? 0}</div>
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
