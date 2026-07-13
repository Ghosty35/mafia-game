'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { FamilyLeaderboardEntry } from '@/lib/types';

const supabase = createClient();

export default function FamiliesLeaderboard() {
  const [families, setFamilies] = useState<FamilyLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [seasonTab, setSeasonTab] = useState<'current' | 'previous' | 'alltime'>('current');

  useEffect(() => {
    const fetchFamilies = async () => {
      setLoading(true);

      // For now we always fetch current. Real season filtering comes later.
      const { data, error } = await supabase.rpc('get_families_leaderboard');

      if (error) {
        console.error('Families leaderboard error:', error);
      } else if (data?.top) {
        setFamilies(data.top);
      } else {
        setFamilies([]);
      }
      setLoading(false);
    };

    fetchFamilies();
  }, [seasonTab]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-red-500 tracking-wider">FAMILIES LEADERBOARD</h1>
          <p className="text-zinc-400 mt-3">Season 1 • The Most Powerful Families in the City</p>
        </div>

        {/* Season Tabs */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-zinc-900 rounded-xl p-1">
            {[
              { id: 'current' as const, label: 'Current Season' },
              { id: 'previous' as const, label: 'Previous Season' },
              { id: 'alltime' as const, label: 'All-Time' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSeasonTab(tab.id)}
                className={`px-6 py-2 rounded-xl font-medium text-sm transition-all ${
                  seasonTab === tab.id 
                    ? 'bg-red-600 text-white' 
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-700">
          <div className="grid grid-cols-12 bg-zinc-800 p-5 text-sm font-semibold text-zinc-400">
            <div className="col-span-1">Rank</div>
            <div className="col-span-4">Family</div>
            <div className="col-span-2 text-center">Tag</div>
            <div className="col-span-2 text-center">Respect</div>
            <div className="col-span-2 text-center">Territory</div>
            <div className="col-span-1 text-center">Members</div>
          </div>

          {loading ? (
            <div className="p-20 text-center text-zinc-500">Loading the Families...</div>
          ) : families.length === 0 ? (
            <div className="p-20 text-center text-zinc-500">
              No Families have risen yet.<br />
              Be the first to create one.
            </div>
          ) : (
            families.map((family, index) => (
              <div 
                key={family.id} 
                className="grid grid-cols-12 p-5 border-t border-zinc-800 hover:bg-zinc-800/70 transition-all items-center"
              >
                <div className="col-span-1 text-3xl font-bold text-red-500">#{index + 1}</div>
                
                <div className="col-span-4">
                  <div className="font-semibold text-xl">{family.name}</div>
                </div>

                <div className="col-span-2 text-center">
                  <span className="inline-block bg-zinc-800 px-3 py-1 rounded font-mono text-red-400 text-sm tracking-widest">
                    {family.tag}
                  </span>
                </div>

                <div className="col-span-2 text-center text-2xl font-semibold text-amber-400">
                  {family.respect.toLocaleString()}
                </div>

                <div className="col-span-2 text-center text-2xl text-emerald-400 font-medium">
                  {family.territory}
                </div>

                <div className="col-span-1 text-center text-xl font-mono text-white">
                  {family.member_count}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-8 text-center text-sm text-zinc-500">
          Families compete for Respect, Territory, and Wars Won.<br />
          The strongest Families will rule the city.
        </div>

        <div className="text-center mt-4">
          <Link href="/families" className="text-red-400 hover:underline text-sm">
            ← Back to Families
          </Link>
        </div>
      </div>
    </div>
  );
}
