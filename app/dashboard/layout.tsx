import type { ReactNode } from 'react';
import GameNav from '../components/GameNav';

// Shared layout for all logged-in game pages (dashboard, and later
// shop, families, rankings...).
export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GameNav />
      {children}
    </>
  );
}
