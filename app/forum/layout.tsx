import type { ReactNode } from 'react';
import { Suspense } from 'react';
import GameLayout from '../components/GameLayout';

export default function ForumLayout({ children }: { children: ReactNode }) {
  return (
    <GameLayout>
      <Suspense fallback={<div className="p-8 text-zinc-500">Loading...</div>}>
        {children}
      </Suspense>
    </GameLayout>
  );
}
