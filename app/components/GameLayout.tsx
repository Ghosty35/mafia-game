'use client';

import type { ReactNode } from 'react';
import { Suspense, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sceneForPath } from './sceneBackgrounds';
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
  const pathname = usePathname();
  // The city changes as you move around it: alley for street ops, casino
  // floor for the tables, bank hall for the money pages, skyline elsewhere.
  const scene = sceneForPath(pathname ?? '/dashboard');

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
      {/* Scene art for this section of the city.
          `key` forces a remount per scene so the fade-in replays on change. */}
      <div
        key={scene.src}
        className="fixed inset-0 bg-cover bg-center pointer-events-none animate-sceneFade"
        style={{ backgroundImage: `url('${scene.src}')` }}
      />
      {/* NOTE: the hand-drawn city-crew.svg silhouettes (1940s fedoras and
          long coats) used to sit here. They read as wrong over the
          neon-cyberpunk scenes, so they're now login/register-only. */}
      {/* Readability scrim - the game UI has to stay legible over the art.
          Per-scene, since a busy casino floor needs more cover than a skyline. */}
      <div
        className="fixed inset-0 pointer-events-none transition-colors duration-500"
        style={{ backgroundColor: `rgba(0,0,0,${scene.scrim})` }}
      />
      {/* Character standing in this scene (e.g. the card sharp on the casino
          floor). Above the scrim so they're not washed out, but well below
          the content layer. xl+ only - on smaller screens they'd sit under
          the stats panels and just look like clutter. */}
      {scene.character && (
        <div
          key={scene.character.src}
          aria-hidden="true"
          className="hidden xl:block fixed right-0 bottom-0 pointer-events-none select-none animate-sceneFade"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scene.character.src}
            alt=""
            className="w-auto object-contain"
            style={{
              height: 'min(58vh, 520px)',
              opacity: scene.character.opacity,
              filter: 'drop-shadow(0 18px 40px rgba(0,0,0,0.9)) saturate(0.9)',
              WebkitMaskImage: 'linear-gradient(to top, transparent 0%, #000 10%)',
              maskImage: 'linear-gradient(to top, transparent 0%, #000 10%)',
            }}
          />
        </div>
      )}
      {/* Live mafia-city atmosphere on top of the global skyline background */}
      <div className="mafia-ambient" />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.03),transparent_50%)]" />
      <LanguageSync />
      <Toast />
      {/* <GameNav /> */}
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

