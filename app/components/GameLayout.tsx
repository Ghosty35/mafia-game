'use client';

import type { ReactNode } from 'react';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GameNav from './GameNav';
import Sidebar from './Sidebar';
import RightSidebar from './RightSidebar';
import PlayerInfoCard from './PlayerInfoCard';
import LanguageSync from './LanguageSync';
import Toast from './Toast';
import MobileBottomNav from './MobileBottomNav';
import { PlayerProvider, usePlayer } from './PlayerContext';
import { MobileDrawerProvider } from './MobileDrawerContext';

function LayoutContent({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  const router = useRouter();

  // Hard lock: dead players go to /dead, jailed players go to /jail.
  // Death always takes priority over jail.
  useEffect(() => {
    const deathTime = player?.death_until ? new Date(player.death_until).getTime() : 0;
    const jailTime = player?.jailed_until ? new Date(player.jailed_until).getTime() : 0;
    const now = Date.now();
    const isDead = deathTime > now;
    const isJailed = jailTime > now;
    if (!isDead && !isJailed) return;

    const path = window.location.pathname;
    if (isDead && path !== '/dead') {
      router.push('/dead');
    } else if (isJailed && path !== '/jail') {
      router.push('/jail');
    }
  }, [player?.death_until, player?.jailed_until, router]);

  return (
    /* No `overflow-x-hidden` here: combined with `relative` on a very tall
       wrapper it makes some mobile browsers clip/mis-render `position: fixed`
       descendants until a reflow (rotating the device) - exactly how the nav
       drawers failed on real Android. Horizontal overflow is contained by
       `overflow-x: clip` on <body> in globals.css instead. */
    <div className="min-h-screen bg-transparent text-white relative">
      {/* Rain-soaked crime-city street at dusk (original generated art) -
          the game world you're playing in. Replaces bg-dashboard.jpg. */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/bg-city-street.webp')" }}
      />
      {/* The crew in silhouette down at street level */}
      <div
        className="fixed inset-x-0 bottom-0 h-[38vh] pointer-events-none opacity-40"
        style={{
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'bottom center',
          backgroundSize: 'cover',
          backgroundImage: "url('/city-crew.svg')",
          WebkitMaskImage: 'linear-gradient(to top, #000 62%, transparent 100%)',
          maskImage: 'linear-gradient(to top, #000 62%, transparent 100%)',
        }}
      />
      {/* Readability scrim - the game UI has to stay legible over the art */}
      <div className="fixed inset-0 bg-black/72 pointer-events-none" />
      {/* Live mafia-city atmosphere on top of the global skyline background */}
      <div className="mafia-ambient" />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.03),transparent_50%)]" />
      <LanguageSync />
      <Toast />
      <GameNav />
      <div className="flex max-w-7xl mx-auto relative">
        {/* Left Sidebar - Crime Related */}
        <Suspense fallback={<div className="w-64 bg-zinc-950 border-r border-zinc-800" />}>
          <Sidebar />
        </Suspense>

        <main className="flex-1 p-4 sm:p-6 min-w-0 pb-24 lg:pb-6">
          <div className="max-w-5xl mx-auto">
            <PlayerInfoCard />
            {children}
          </div>
        </main>

        {/* Right Sidebar - Family / Info / Murder / Economy */}
        <Suspense fallback={<div className="w-64 bg-zinc-950 border-l border-zinc-800" />}>
          <RightSidebar />
        </Suspense>
      </div>
      <MobileBottomNav />
    </div>
  );
}

export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <MobileDrawerProvider>
        <LayoutContent>{children}</LayoutContent>
      </MobileDrawerProvider>
    </PlayerProvider>
  );
}

