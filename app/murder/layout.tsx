import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function MurderLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
