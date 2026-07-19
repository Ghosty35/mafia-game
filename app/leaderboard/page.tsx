'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import { getRank } from '@/lib/ranks';
import RipButton from '../components/RipButton';
import type { LeaderboardData, LeaderboardEntry } from '@/lib/types';

// Overall Power calculation (Bulletstar style - heavy on rebirths + level + activity)
function calculatePower(entry: LeaderboardEntry): number {
  const crimes = entry.crimes || 0;
  return Math.floor((entry.rebirths * 100000) + (entry.level * 5000) + (crimes * 150));
}

function formatPower(n: number, language: string) {
  return new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(n);
}

export default function LeaderboardPage() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: result, error } = await supabase.rpc('get_leaderboard');

      if (error || !result) {
        setData({ top: [], me: null });
      } else {
        setData(result as LeaderboardData);
      }
      setLoading(false);
    };

    fetchLeaderboard();
  }, []);

  const players = (data?.top ?? []).map((p) => ({
    ...p,
    power: calculatePower(p),
  }));

  const me = data?.me ?? null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Compact header matching other sections */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">{t('lb_title')}</h1>
        <p className="text-xs text-zinc-400">{t('lb_subtitle')}</p>
      </div>

      {/* Compact table - smaller, less overwhelming */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
        <div className="grid grid-cols-12 bg-zinc-800 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-1 text-center">#</div>
          <div className="col-span-3">{t('lb_col_name')}</div>
          <div className="col-span-2 text-right">{t('lb_col_power')}</div>
          <div className="col-span-2 text-right">{t('lb_col_cash')}</div>
          <div className="col-span-2">{t('lb_col_rank')}</div>
          <div className="col-span-2">{t('lb_col_family')}</div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-zinc-500 text-sm">{t('lb_loading')}</div>
          ) : players.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">{t('lb_empty')}</div>
          ) : (
            players.map((player) => {
              const rankInfo = getRank(player.level);
              const displayRank = t(rankInfo.key);
              const hasFamily = !!player.family_tag;

              return (
                <div
                  key={player.username}
                  className={`grid grid-cols-12 px-3 py-1.5 border-t border-zinc-800 items-center hover:bg-zinc-800/60 transition-all ${
                    me && player.username === me.username ? 'bg-red-950/20' : ''
                  }`}
                >
                  <div className="col-span-1 text-center font-mono text-red-500 font-semibold text-xs">
                    #{player.pos}
                  </div>

                  <div className="col-span-3 font-medium truncate pr-2">
                    <Link href={`/profile?user=${player.username}`} className="hover:underline text-red-400">
                      {player.username}
                    </Link>
                  </div>

                  <div className="col-span-2 text-right font-mono font-semibold text-white tabular-nums">
                    {formatPower(player.power, language)}
                  </div>

                  <div className="col-span-2 text-right font-mono text-emerald-400 tabular-nums">
                    {formatCash(player.cash ?? 0, language)}
                  </div>

                  <div className="col-span-2 text-xs text-zinc-300 truncate">
                    {displayRank}
                  </div>

                  <div className="col-span-2 flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[10px] text-red-400 font-mono truncate">
                      {hasFamily ? `${player.family_tag} — ${player.family_name}` : '—'}
                    </span>
                    <span className="shrink-0">
                      <RipButton targetUsername={player.username} />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {me && (
        <p className="mt-2 text-center text-[10px] text-zinc-400">
          {t('lb_your_rank')} <span className="text-red-400 font-semibold">#{me.pos}</span>
        </p>
      )}

      <div className="mt-6 text-center">
        <Link href="/families/leaderboard" className="text-xs text-red-400 hover:underline">
          {t('lb_view_families')}
        </Link>
      </div>
    </div>
  );
}
