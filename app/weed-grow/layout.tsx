import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function WeedGrowLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
