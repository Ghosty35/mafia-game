import type { ReactNode } from 'react';
import GameLayout from '../components/GameLayout';

export default function GarageLayout({ children }: { children: ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
