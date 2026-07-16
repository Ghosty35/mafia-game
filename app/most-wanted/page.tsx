'use client';

import Link from 'next/link';
import MostWantedBoard from '../components/MostWantedBoard';

export default function MostWantedPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">🚨 Most Wanted</h1>
        <p className="text-xs text-zinc-400">
          The hottest criminals in the city, ranked by heat. Lay low, bribe a cop, or hire a lawyer to drop off the list.
        </p>
      </div>

      <MostWantedBoard limit={50} />

      <div className="mt-6 text-center">
        <Link href="/leaderboard" className="text-xs text-red-400 hover:underline">
          View Power Leaderboard →
        </Link>
      </div>
    </div>
  );
}
