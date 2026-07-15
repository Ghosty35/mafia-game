'use client';

import type { ReactNode } from 'react';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GameNav from './GameNav';
import Sidebar from './Sidebar';
import RightSidebar from './RightSidebar';
import PlayerInfoCard from './PlayerInfoCard';
import LiveTracker from './LiveTracker';
import LanguageSync from './LanguageSync';
import Toast from './Toast';
import { PlayerProvider, usePlayer } from './PlayerContext';

function LayoutContent({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  const router = useRouter();

  // Enforce death lock - only allow leaderboards and jail when dead
  // Jail allows training breakout skills
  useEffect(() => {
    if (player?.death_until && new Date(player.death_until).getTime() > Date.now()) {
      const path = window.location.pathname;
      if (!path.includes('/leaderboard') && !path.includes('/dead') && !path.includes('/jail')) {
        router.push('/dead');
      }
    }
  }, [player?.death_until, router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <LanguageSync />
      <Toast />
      <GameNav />
      <div className="flex max-w-7xl mx-auto">
        {/* Left Sidebar - Crime Related */}
        <Suspense fallback={<div className="w-64 bg-zinc-950 border-r border-zinc-800" />}>
          <Sidebar />
        </Suspense>

        <main className="flex-1 p-4 sm:p-6 min-w-0">
          <div className="max-w-5xl mx-auto">
            <PlayerInfoCard />
            <LiveTracker />
            {children}
          </div>
        </main>

        {/* Right Sidebar - Family / Info / Murder / Economy */}
        <Suspense fallback={<div className="w-64 bg-zinc-950 border-l border-zinc-800" />}>
          <RightSidebar />
        </Suspense>
      </div>
    </div>
  );
}

export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <LayoutContent>{children}</LayoutContent>
    </PlayerProvider>
  );
}

