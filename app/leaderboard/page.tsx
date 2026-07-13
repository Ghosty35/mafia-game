'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { LeaderboardData, LeaderboardEntry } from '@/lib/types';

type MetricTab = 'overall' | 'crimes';
type SeasonTab = 'current' | 'previous' | 'alltime';

export default function Leaderboard() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MetricTab>('overall');
  const [seasonTab, setSeasonTab] = useState<SeasonTab>('current');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_leaderboard');
      if (error) {
        console.error('Leaderboard error:', error);
        setData({ top: [], me: null });
      } else {
        setData((data as LeaderboardData) ?? { top: [], me: null });
      }
      setLoading(false);
    };
    fetchLeaderboard();
  }, []);

  const players: LeaderboardEntry[] =
    activeTab === 'crimes'
      ? [...(data?.top ?? [])].sort((a, b) => b.crimes - a.crimes)
      : (data?.top ?? []);

  const me = data?.me ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-red-500 tracking-wider">GLOBAL LEADERBOARD</h1>
          <p className="text-zinc-400 mt-3">Season 1 • Individual Player Rankings</p>
        </div>

        {/* Season Tabs (historical views arrive with the seasons system) */}
        <div className="flex justify-center mb-4">
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
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metric Tabs */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-zinc-900 rounded-xl p-1">
            {[
              { id: 'overall' as const, label: 'Overall Power' },
              { id: 'crimes' as const, label: 'Criminal Mastermind' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-8 py-3 rounded-xl font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {seasonTab !== 'current' && (
          <div className="text-center mb-4 text-amber-400 text-sm">
            Previous season and All-time views will show historical data once seasons are implemented.
          </div>
        )}

        <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-700">
          <div className="grid grid-cols-12 bg-zinc-800 p-5 text-sm font-semibold text-zinc-400">
            <div className="col-span-1">Rank</div>
            <div className="col-span-5">Player</div>
            <div className="col-span-2 text-center">Level</div>
            <div className="col-span-2 text-center">Rebirths</div>
            <div className="col-span-2 text-center">Crimes</div>
          </div>

          {loading ? (
            <div className="p-20 text-center text-zinc-500">Loading the underworld rankings...</div>
          ) : players.length === 0 ? (
            <div className="p-20 text-center text-zinc-500">No players found yet</div>
          ) : (
            players.map((player, index) => (
              <div
                key={player.username}
                className={`grid grid-cols-12 p-5 border-t border-zinc-800 hover:bg-zinc-800/70 transition-all items-center ${
                  me && player.username === me.username ? 'bg-red-950/30' : ''
                }`}
              >
                <div className="col-span-1 text-3xl font-bold text-red-500">#{index + 1}</div>

                <div className="col-span-5 flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-700 rounded-full flex items-center justify-center text-3xl">
                    {player.rebirths > 0 ? '👑' : '👤'}
                  </div>
                  <div>
                    <div className="font-semibold text-xl">{player.username}</div>
                    {player.family_tag && (
                      <div className="text-xs text-red-400 font-mono tracking-wider">
                        {player.family_tag} • {player.family_name}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-span-2 text-center text-4xl font-mono text-white">
                  {player.level}
                </div>

                <div className="col-span-2 text-center text-2xl text-amber-400 font-medium">
                  {player.rebirths}
                </div>

                <div className="col-span-2 text-center text-2xl font-semibold text-white">
                  {player.crimes}
                </div>
              </div>
            ))
          )}
        </div>

        {me && (
          <p className="text-center text-sm text-zinc-400 mt-4">
            Your position: <span className="text-red-400 font-bold">#{me.pos}</span> • {me.username}
          </p>
        )}

        <p className="text-center text-xs text-zinc-500 mt-6">
          Global Leaderboard • See the{' '}
          <Link href="/families/leaderboard" className="text-red-400 hover:underline">
            Families Leaderboard
          </Link>{' '}
          for Family rankings.
        </p>
      </div>
    </div>
  );
}
