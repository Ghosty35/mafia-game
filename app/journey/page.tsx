'use client';

import Link from 'next/link';

export default function JourneyPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-4xl font-bold mb-2">🗺️ Your Journey</h1>
      <p className="text-zinc-400 mb-8">Everything you need to survive and rise in the streets of 2026. Pick a section below.</p>

      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/journey/guide" className="card p-6 hover:border-red-600 transition block">
          <div className="text-2xl mb-2">📖</div>
          <h3 className="font-bold text-xl">Player Guide</h3>
          <p className="text-sm text-zinc-400 mt-1">Full friendly guide to all systems, tips, and how to progress.</p>
        </Link>

        <Link href="/journey/tips" className="card p-6 hover:border-red-600 transition block">
          <div className="text-2xl mb-2">💡</div>
          <h3 className="font-bold text-xl">In-Game Tips</h3>
          <p className="text-sm text-zinc-400 mt-1">Helpful tooltips and quick advice extracted from the systems.</p>
        </Link>

        <Link href="/journey/menus" className="card p-6 hover:border-red-600 transition block">
          <div className="text-2xl mb-2">🧭</div>
          <h3 className="font-bold text-xl">How to Use Menus</h3>
          <p className="text-sm text-zinc-400 mt-1">Explanation of every menu, tab, and navigation in the game.</p>
        </Link>

        <Link href="/journey/roadmap" className="card p-6 hover:border-red-600 transition block">
          <div className="text-2xl mb-2">🚀</div>
          <h3 className="font-bold text-xl">Roadmap & Future</h3>
          <p className="text-sm text-zinc-400 mt-1">What's coming next, including Casino, Lottery, and more.</p>
        </Link>
      </div>

      <div className="mt-8 text-xs text-zinc-500">
        This section is your central hub for learning the game. More tips and guides will be added over time. (Source: docs/INDEX.md and system files)
      </div>
    </div>
  );
}
