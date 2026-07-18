'use client';

import { PlayerProvider } from '../components/PlayerContext';

export default function HustlersWayLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerProvider>
      {children}
    </PlayerProvider>
  );
}
