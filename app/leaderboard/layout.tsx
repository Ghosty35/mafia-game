import type { ReactNode } from 'react';
import GameNav from '../components/GameNav';

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GameNav />
      {children}
    </>
  );
}
