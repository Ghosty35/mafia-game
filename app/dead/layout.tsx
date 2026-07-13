import type { ReactNode } from 'react';
import { PlayerProvider } from '../components/PlayerContext';

export default function DeadLayout({ children }: { children: ReactNode }) {
  return <PlayerProvider>{children}</PlayerProvider>;
}
