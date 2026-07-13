'use client';

import Link from 'next/link';

export default function RoadmapPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">← Back to Journey</Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">🚀 Roadmap & Future</h1>
      <p className="text-zinc-400 mb-6">What’s coming next and what we’re building toward.</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-bold mb-3">Coming Soon</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Casino Games</strong>: Blackjack, Roulette, and more. All bank losses feed into a central Casino Bank (with sub-categories per game).</li>
            <li><strong>Weekly Friday Lottery</strong>: Pull system with items and jackpots. Non-donators have higher win chance than donators.</li>
            <li><strong>Vehicle Health & Tuning Overhaul</strong>: Full car list (low/mid/high/super), real images on steal, mod system.</li>
            <li><strong>More Live Trackers</strong>: Central cooldown page + better widget across the game.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">Long Term Vision</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Professional UI with consistent backgrounds and images across all menus.</li>
            <li>Full in-game help system pulled from these docs (tooltips everywhere).</li>
            <li>Deeper economy (more realistic taxes, property earnings that actually accumulate over time).</li>
            <li>Expanded family wars and territory.</li>
            <li>More 2-player and group events.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">Documentation & Help (Current Focus)</h2>
          <p className="text-sm">We’re building a complete set of living documents so that:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
            <li>Any AI can read the current state and help effectively.</li>
            <li>Players get clear, helpful tips directly in the game.</li>
            <li>Everything stays consistent as the game grows.</li>
          </ul>
        </section>
      </div>

      <div className="mt-10 p-4 bg-zinc-900 rounded text-xs text-zinc-400">
        This Roadmap page will be updated regularly. Check back often.
      </div>
    </div>
  );
}
