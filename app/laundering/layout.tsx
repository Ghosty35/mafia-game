import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function LaunderingLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
