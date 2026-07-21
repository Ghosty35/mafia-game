'use client';

import type { ReactNode } from 'react';
import { PlayerProvider, usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function HustlersWayLock({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  const router = useRouter();

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

  return <>{children}</>;
}

export default function HustlersWayLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <HustlersWayLock>
        <div className="min-h-screen bg-transparent text-white relative">
          {/* Night-city street scene (replaces the old bg-hustlers.jpg photo) */}
          <div
            className="fixed inset-x-0 bottom-0 h-[46vh] pointer-events-none opacity-[0.55]"
            style={{
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'bottom center',
              backgroundSize: 'cover',
              backgroundImage: "url('/city-crew.svg')",
              WebkitMaskImage: 'linear-gradient(to top, #000 62%, transparent 100%)',
              maskImage: 'linear-gradient(to top, #000 62%, transparent 100%)',
            }}
          />
          <div className="fixed inset-0 bg-black/45 pointer-events-none" />
          {children}
        </div>
      </HustlersWayLock>
    </PlayerProvider>
  );
}
