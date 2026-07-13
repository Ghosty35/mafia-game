'use client';

import Link from 'next/link';

export default function TipsPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">← Back to Journey</Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">💡 In-Game Tips & Tooltips</h1>
      <p className="text-zinc-400 mb-6">Quick helpful advice pulled straight from the game systems.</p>

      <div className="space-y-6">
        <div className="card p-5">
          <h3 className="font-semibold mb-2">Crimes</h3>
          <ul className="text-sm space-y-1">
            <li>• Pickpocket: "Easy money from careless tourists. Low risk, but low reward."</li>
            <li>• Rob Store: "Hit a store. Medium risk, decent payout. Watch the heat!"</li>
            <li>• Steal Car: "Boost a ride for the garage or a quick flip."</li>
            <li>• No XP on failure. Success is the only teacher.</li>
          </ul>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-2">Family</h3>
          <ul className="text-sm space-y-1">
            <li>• "Donate to the family. Leaders turn it into Power for everyone’s hourly pay (60% bank, 40% cash)."</li>
            <li>• "Power = family strength. More power = bigger hourly payouts for all members."</li>
          </ul>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-2">Safehouse & Properties</h3>
          <ul className="text-sm space-y-1">
            <li>• "Own the city. Grow your empire (and weed). Pay your bills on time or lose it all."</li>
            <li>• "Mansions have a secret Piggybank – hidden from the global leaderboard but visible to your family."</li>
            <li>• Buy properties only in your current city. Travel to see others.</li>
          </ul>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-2">Banking</h3>
          <ul className="text-sm space-y-1">
            <li>• "Personal Bank: Safer than your pocket. Small tax on moves."</li>
            <li>• "Piggybank (Mansion only): Your hidden stash. Doesn’t count toward global wealth."</li>
            <li>• All big transfers now require confirmation before execution.</li>
          </ul>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-2">General Rules</h3>
          <ul className="text-sm space-y-1">
            <li>• "Heat is dangerous. High heat = random police trouble."</li>
            <li>• "Donator perks stack on top of everything – including double XP events."</li>
            <li>• "Always confirm big money moves. The streets don’t forgive mistakes."</li>
            <li>• "2 second cooldown between actions to keep things fair."</li>
          </ul>
        </div>
      </div>

      <p className="mt-8 text-xs text-zinc-500">These tips are extracted from the live game systems and will be expanded over time.</p>
    </div>
  );
}
