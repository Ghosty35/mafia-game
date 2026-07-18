import type { ReactNode } from 'react';
import { PlayerProvider, usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function DeadLock({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  const router = useRouter();

  useEffect(() => {
    const deathTime = player?.death_until ? new Date(player.death_until).getTime() : 0;
    const jailTime = player?.jailed_until ? new Date(player.jailed_until).getTime() : 0;
    const now = Date.now();
    const isDead = deathTime > now;
    const isJailed = jailTime > now;
    if (isDead) return;
    if (isJailed) {
      router.push('/jail');
    }
  }, [player?.death_until, player?.jailed_until, router]);

  return <>{children}</>;
}

export default function DeadLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <DeadLock>{children}</DeadLock>
    </PlayerProvider>
  );
}
