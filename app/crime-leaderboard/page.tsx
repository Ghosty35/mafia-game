'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type Board = { username: string; value: number }[];
type LeaderData = {
  top_crimes: Board;
  top_heists: Board;
  top_murders: Board;
  top_races: Board;
  top_drugs: Board;
};

const CATS: { key: keyof LeaderData; icon: string }[] = [
  { key: 'top_crimes', icon: '🔫' },
  { key: 'top_heists', icon: '💣' },
  { key: 'top_murders', icon: '🔥' },
  { key: 'top_races', icon: '🏁' },
  { key: 'top_drugs', icon: '💊' },
];

export default function CrimeLeaderboardPage() {
  const { t, fm } = useLanguage();
  const [data, setData] = useState<LeaderData | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc('get_crime_leaderboard').then(({ data: d }) => {
      if (d) setData(d as LeaderData);
    });
  }, []);

  return (
    <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🏆 {t('cl_title')}</h1>
        <p className="text-xs text-zinc-400">{t('cl_desc')}</p>
      </div>

      {!data ? (
        <div className="text-center text-zinc-500 py-10">{t('cl_loading')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CATS.map((c) => {
            const board = data[c.key] ?? [];
            return (
              <div key={c.key} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{c.icon}</span>
                  <h2 className="font-bold text-sm text-amber-400">{t(('cl_' + c.key) as TranslationKey)}</h2>
                </div>
                {board.length === 0 ? (
                  <p className="text-xs text-zinc-500">{t('cl_empty')}</p>
                ) : (
                  <ol className="space-y-1.5">
                    {board.map((row, i) => (
                      <li key={row.username} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className={`w-5 text-center font-bold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-600' : 'text-zinc-500'}`}>
                            {i + 1}
                          </span>
                          <span className="text-zinc-200">{row.username}</span>
                        </span>
                        <span className="font-mono text-emerald-400">{fm(row.value)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
