import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function JourneyLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
