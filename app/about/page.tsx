'use client';

import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-black tracking-tighter mb-2">ABOUT THE GAME</h1>
        <p className="text-zinc-400">Mafia Game 2026 — Rise from the gutter. Become legend.</p>
      </div>

      {/* The Intro Story */}
      <div className="card p-8 mb-8 bg-zinc-900 border border-zinc-800">
        <div className="prose prose-invert max-w-none text-zinc-200 leading-relaxed">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Start Your Journey</h2>
          
          <p className="mb-4">
            The year is 2026. The streets have never been colder, the cities never more divided. 
            Five ruthless metropolises — New York, Chicago, Los Angeles, Miami, and Las Vegas — 
            are battlegrounds where only the bold survive.
          </p>

          <p className="mb-4">
            You wake up with nothing but the clothes on your back and a hunger in your gut. 
            No family. No reputation. No power. Just a name and the choice that will define you.
          </p>

          <p className="mb-4">
            <strong className="text-white">You decide how you become the God of the Streets.</strong>
          </p>

          <p className="mb-4">
            Will you start small — picking pockets in the alleys, running low-risk street deals, 
            building your first stack of dirty cash? Or will you chase the big scores: bank heists, 
            high-stakes murders, and territory wars that can make or break entire families?
          </p>

          <div className="my-6 border-l-4 border-red-600 pl-5 italic text-zinc-300">
            “Every choice leaves a mark. Every crime builds your legend. Every alliance or betrayal 
            writes the next chapter of your story. In this world, loyalty is currency and power is the only law.”
          </div>

          <p className="mb-4">
            Grow your empire through crime, heists, and calculated violence. Master the art of murder 
            as a true Hitman. Build hidden weed operations in safehouses across cities. Race for pink slips 
            and tune the fastest cars in the underground. Invest in real estate that generates passive income 
            — and risk — while you sleep.
          </p>

          <p className="mb-4">
            But no one rises alone. Form or join a Family. Donate to the treasury, watch your leaders 
            convert blood money into raw Family Power. That power fuels deadly wars, strengthens your 
            attack and defense, and — most importantly — generates real hourly pay for every loyal member. 
            60% lands safely in the bank. 40% hits your pocket in cash. The stronger the family, the richer 
            every soldier becomes.
          </p>

          <p className="mb-4">
            Travel between cities to exploit shifting economies. Buy low in one, sell high in another. 
            Own properties only where you currently stand — you must travel to see and claim the best 
            real estate of other territories.
          </p>

          <p className="mb-6">
            Climb the ranks. From Hobo to Kingpin. From lone wolf to the most feared Family on the 
            leaderboards. Diamonds open VIP doors: personal buffs, and powerful Family upgrades that 
            make your crew unstoppable. Smart players know when bundles of diamonds give the edge.
          </p>

          <p className="text-lg font-semibold text-red-400">
            This is your story.<br />
            The streets are watching.<br />
            Will you become the God of the Streets?
          </p>
        </div>
      </div>

      {/* Quick facts / tone */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">THE LOOP</div>
          <div className="text-sm text-zinc-300">Crime → Heist → Murder → Build → Family Power → Repeat. Every action feeds your legend and your wallet.</div>
        </div>
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">THE CITIES</div>
          <div className="text-sm text-zinc-300">5 living cities with shifting prices. Travel to unlock new opportunities, properties, and better runs.</div>
        </div>
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">THE FAMILIES</div>
          <div className="text-sm text-zinc-300">Donate. Buy power. Grow hourly payouts. Wage wars. The leaderboard never forgets who ran the city.</div>
        </div>
      </div>

      <div className="text-center text-xs text-zinc-500 mb-4">
        Mafia Game 2026 • Everything is connected. Your choices echo across the underworld.
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-red-400 hover:underline">← Return to the streets</Link>
    </div>
  );
}
