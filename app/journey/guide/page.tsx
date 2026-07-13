'use client';

import Link from 'next/link';

export default function PlayerGuidePage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">← Back to Journey</Link>
      
      <h1 className="text-3xl font-bold mt-4 mb-2">📖 Player Guide</h1>
      <p className="text-zinc-400 mb-6">A friendly walkthrough of the game. Read this first if you're new.</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-3">Getting Started</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Start with low-risk crimes like Pickpocket to build your first cash and XP.</li>
            <li>Level up and unlock better crimes, heists, and murder.</li>
            <li>Buy a House in Real Estate as soon as you can — this unlocks Weed Growing.</li>
            <li>Join or create a Family to earn passive hourly pay.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">Core Systems</h2>
          <div className="grid gap-4">
            <div>
              <strong>Crimes & Heists</strong><br />
              Commit crimes to earn cash and XP. Failures give no XP. Heat builds up and can lead to extra jail time. Donators get +25% XP and +20% cash.
            </div>
            <div>
              <strong>Families</strong><br />
              Create or join one. Donate to build the family bank. Leaders buy Power, which gives everyone hourly pay (60% to your personal bank, 40% cash).
            </div>
            <div>
              <strong>Safehouse & Properties</strong><br />
              Buy Houses, Villas, or Mansions. They give you weed growing spots, car storage, and (for Mansions) a hidden Piggybank.
            </div>
            <div>
              <strong>Weed Growing</strong><br />
              Water plants to build progress (0/5 to 5/5). Quality % affects your final harvest. Can fail and go negative.
            </div>
            <div>
              <strong>Banking</strong><br />
              Personal Bank for safety. Family Bank shared with crew. Mansion owners get a secret Piggybank (hidden from global leaderboard).
            </div>
            <div>
              <strong>Racing</strong><br />
              Post 2-player races. Choose your car (needs good condition). Entry fees and betting. 10-minute cooldown after.
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">Important Tips</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>No XP on failure. Success is the only way to level.</li>
            <li>Keep your heat low — high heat means random police trouble.</li>
            <li>Always confirm big money moves.</li>
            <li>Donator perks stack with events and rebirths.</li>
            <li>Properties cost money to maintain — pay your bills.</li>
          </ul>
        </section>
      </div>

      <div className="mt-10 text-xs text-zinc-500">
        This is a living guide. More details will be added as the game grows.
      </div>
    </div>
  );
}
