import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function CrimesLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
