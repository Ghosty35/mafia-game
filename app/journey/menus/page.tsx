'use client';

import Link from 'next/link';

export default function MenusPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">← Back to Journey</Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">🧭 How to Use the Menus</h1>
      <p className="text-zinc-400 mb-6">Quick explanation of the main navigation and where everything lives.</p>

      <div className="space-y-8 text-sm">
        <div>
          <h3 className="font-semibold mb-2">Sidebar (Left)</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Street Operations</strong>: Crimes, Street Dealer, Weed Grow, Safehouse, Race, Admin Tools</li>
            <li><strong>Family</strong>: My Family (with Bank, Profile, Jail)</li>
            <li><strong>Support Services</strong>: Hospital, Metal Factory, Personal Bank</li>
            <li><strong>Journey</strong>: Player Guide, In-Game Tips, How to Use Menus, Roadmap</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Top Navigation</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Home</strong>: Goes to the main dashboard / front page with round info and live clocks</li>
            <li><strong>Online</strong>: Server Status page (live player counts, families, money circulation)</li>
            <li><strong>About</strong>: Game story and lore</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Right Sidebar</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Family & Social (My Family, Messages, etc.)</li>
            <li>Reputation (Leaderboards)</li>
            <li>Murder & PvP</li>
            <li>Information & Economy (Real Estate, Marketplace, Street Dealer)</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Important Pages</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Safehouse</strong>: Your properties, Piggybank (Mansion), Shed, Garage</li>
            <li><strong>Bank</strong>: Personal Bank (Cash ↔ Bank)</li>
            <li><strong>Families</strong>: Create/join family, banking, power, members</li>
            <li><strong>Jail</strong>: Train breakout skills</li>
            <li><strong>Journey</strong>: All help and guides (this section)</li>
          </ul>
        </div>
      </div>

      <p className="mt-8 text-xs text-zinc-500">Most pages have their own sub-tabs and live data. Use the Journey menu when you’re lost.</p>
    </div>
  );
}
