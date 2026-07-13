'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRank } from '@/lib/ranks';
import type { LeaderboardData } from '@/lib/types';
import Link from 'next/link';

export default function RankingsClient({ 
  leaderboard, 
  loadError 
}: { 
  leaderboard: LeaderboardData; 
  loadError: boolean;
}) {
  const { t } = useLanguage();

  if (loadError) {
    return (
      <main className="p-8 max-w-4xl mx-auto text-center">
        <p className="text-red-500">{t('error_load_leaderboard')}</p>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-red-500">{t('rankings_title')}</h1>
        <p className="text-zinc-400 mt-1">Global Player Rankings • Season 1</p>
      </div>

      <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-700">
        <div className="grid grid-cols-12 bg-zinc-800 p-4 text-sm font-semibold text-zinc-400">
          <div className="col-span-1">{t('rankings_position')}</div>
          <div className="col-span-5">{t('rankings_player')}</div>
          <div className="col-span-2 text-center">{t('rankings_level')}</div>
          <div className="col-span-2 text-center">{t('rankings_rebirths')}</div>
          <div className="col-span-2 text-center">{t('rankings_rank')}</div>
        </div>

        {leaderboard.top.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">{t('rankings_empty')}</div>
        ) : (
          leaderboard.top.map((entry) => (
            <div key={entry.pos} className="grid grid-cols-12 p-4 border-t border-zinc-800 items-center hover:bg-zinc-800/60">
              <div className="col-span-1 font-bold text-red-500">
                {entry.pos === 1 ? '🥇' : entry.pos === 2 ? '🥈' : entry.pos === 3 ? '🥉' : `#${entry.pos}`}
              </div>
              <div className="col-span-5 font-semibold">
                {entry.username}
                {leaderboard.me && entry.username === leaderboard.me.username && (
                  <span className="ml-2 text-xs bg-red-900/70 text-red-300 px-2 py-0.5 rounded-full">
                    {t('rankings_you')}
                  </span>
                )}
              </div>
              <div className="col-span-2 text-center text-xl font-mono">{entry.level}</div>
              <div className="col-span-2 text-center text-amber-400">{entry.rebirths}</div>
              <div className="col-span-2 text-center text-sm text-zinc-400">
                {t(getRank(entry.level).key)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-8 text-center">
        <Link href="/leaderboard" className="text-red-400 hover:underline">
          → View the full Global Leaderboard with more categories
        </Link>
        <br />
        <Link href="/families/leaderboard" className="text-red-400 hover:underline mt-2 inline-block">
          → View the Families Leaderboard
        </Link>
      </div>
    </main>
  );
}
