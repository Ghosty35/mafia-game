'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { FamilyLeaderboardEntry } from '@/lib/types';

export default function FamiliesLeaderboardPage() {
  const [families, setFamilies] = useState<FamilyLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFamilies = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_families_leaderboard');

      if (!error && data?.top) {
        setFamilies(data.top);
      } else {
        setFamilies([]);
      }
      setLoading(false);
    };

    fetchFamilies();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Compact header - matching players leaderboard style */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Families Leaderboard</h1>
        <p className="text-xs text-zinc-400">All families • Ranked by total respect + family power (hourly &amp; wars)</p>
      </div>

      {/* Compact table - same tight style as players leaderboard */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
        <div className="grid grid-cols-12 bg-zinc-800 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-1 text-center">#</div>
          <div className="col-span-4">Family</div>
          <div className="col-span-2 text-center">Tag</div>
          <div className="col-span-2 text-right">Respect</div>
          <div className="col-span-2 text-right">Power</div>
          <div className="col-span-1 text-center">Members</div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading...</div>
        ) : families.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">
            No families yet. Be the first to start one.
          </div>
        ) : (
          families.map((family, index) => (
            <div
              key={family.id}
              className="grid grid-cols-12 px-3 py-1.5 border-t border-zinc-800 items-center hover:bg-zinc-800/60 transition-all"
            >
              <div className="col-span-1 text-center font-mono text-red-500 font-semibold text-xs">
                #{family.pos ?? index + 1}
              </div>

              <div className="col-span-4 font-medium truncate">
                {family.name}
              </div>

              <div className="col-span-2 text-center">
                <span className="inline-block bg-zinc-800 px-2 py-px rounded font-mono text-red-400 text-[10px] tracking-widest">
                  {family.tag}
                </span>
              </div>

              <div className="col-span-2 text-right font-mono text-amber-400 tabular-nums text-xs">
                {family.respect.toLocaleString()}
              </div>

              <div className="col-span-2 text-right font-mono text-orange-400 tabular-nums text-xs font-semibold">
                {(family as any).power?.toLocaleString?.() ?? '—'}
              </div>

              <div className="col-span-1 text-center font-mono text-white text-xs">
                {family.member_count}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 text-center text-[10px] text-zinc-500">
        Family power = built from donations (via leaders buying power). Drives hourly pay (60/40) and Fam Wars strength.
      </div>

      <div className="mt-4 text-center">
        <Link href="/leaderboard" className="text-xs text-red-400 hover:underline">
          ← Back to Leaderboard (Players)
        </Link>
      </div>
    </div>
  );
}
