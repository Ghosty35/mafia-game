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
          {/* Rain-soaked crime-city street (original generated art) */}
          <div
            className="fixed inset-0 bg-cover bg-center pointer-events-none"
            style={{ backgroundImage: "url('/bg-city-street.webp')" }}
          />
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
          <div className="fixed inset-0 bg-black/72 pointer-events-none" />
          {children}
        </div>
      </HustlersWayLock>
    </PlayerProvider>
  );
}
