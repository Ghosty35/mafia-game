'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from './PlayerContext';
import { getRank } from '@/lib/ranks';
import type { Player } from '@/lib/types';

interface PlayerInfoCardProps {
  player?: Player;
  familyStatus?: {
    family_name: string | null;
    family_tag: string | null;
  } | null;
}

export default function PlayerInfoCard({ player: propPlayer, familyStatus: propFamily }: PlayerInfoCardProps) {
  const { t, language } = useLanguage();
  const context = usePlayer();
  const player = propPlayer || context.player;
  const [familyStatus, setFamilyStatus] = useState(propFamily || null);

  // If no prop family, try to fetch once
  useEffect(() => {
    if (propFamily) {
      setFamilyStatus(propFamily);
      return;
    }
    if (!player) return;

    const fetchFamily = async () => {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: fam } = await supabase.rpc('get_my_family_status');
      if (fam) setFamilyStatus(fam as any);
    };
    fetchFamily();
  }, [player?.id, propFamily]);

  if (!player) {
    return <div className="card p-3 mb-4 animate-pulse h-20 bg-zinc-900 border border-zinc-800" />;
  }

  const health = player.health ?? 100;
  const level = player.level ?? 1;
  const xp = player.xp ?? 0;
  const murderSkill = player.murder_skill ?? 0;
  // Always show real DB cash — a display-only boost caused desync between menus
  const cash = player.cash ?? 0;
  const diamonds = player.diamonds ?? 0;
  const power = player.power ?? (level * 50 + (player.rebirths ?? 0) * 500);
  const heat = player.heat ?? 0;
  const protection = player.protection ?? 0;

  const rank = getRank(level);
  const rankName = t(rank.key as any);

  const xpForNext = level * 100;
  const expProgress = Math.min(100, Math.floor((xp / xpForNext) * 100));
  const murderProgress = Math.min(100, Math.floor(murderSkill * 5));

  const formatNum = (n: number) => 
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));

  return (
    <div className="mb-4">
      <div className="card p-3 border border-zinc-700 bg-zinc-900/90">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {/* Identity + Rank */}
          <div className="min-w-[160px]">
            <div className="flex items-center gap-2">
              <span className={`font-bold text-base ${player.is_donator ? 'text-yellow-400' : ''}`}>{player.username || 'Unknown'}</span>
              {player.is_donator && <span className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-black rounded font-bold tracking-normal">DONATOR</span>}
              {familyStatus?.family_tag && (
                <span className="text-[10px] px-1.5 py-px rounded bg-red-950 text-red-400 font-mono tracking-wider">
                  {familyStatus.family_tag}
                </span>
              )}
            </div>
            <div className="text-[10px] text-amber-400 font-medium tracking-wide">{rankName} {player.leaderboard_rank ? `(#${player.leaderboard_rank})` : ''}</div>
          </div>

          {/* Bars - Health, Level, KillSkill */}
          <div className="flex flex-1 min-w-[280px] items-center gap-4">
            {/* Health */}
            <div className="flex-1 min-w-[90px]">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                <span>♥ Health</span>
                <span className="font-mono text-emerald-400">{health}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className={`h-1.5 transition-all ${health > 60 ? 'bg-emerald-500' : health > 30 ? 'bg-yellow-500' : 'bg-red-500'}`} 
                  style={{ width: `${health}%` }} 
                />
              </div>
            </div>

            {/* Level + Exp */}
            <div className="flex-1 min-w-[90px]">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                <span>Level {level}</span>
                <span className="font-mono text-xs">{formatNum(xp)}/{formatNum(xpForNext)}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-1.5 bg-red-600" style={{ width: `${expProgress}%` }} />
              </div>
            </div>

            {/* KillSkill */}
            <div className="flex-1 min-w-[90px]">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                <span>KillSkill</span>
                <span className="font-mono text-purple-400 text-xs">{murderSkill.toFixed(2)}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-1.5 bg-purple-500" style={{ width: `${murderProgress}%` }} />
              </div>
            </div>
          </div>

          {/* Resources */}
          <div className="flex items-center gap-x-5 text-sm min-w-[240px] border-l border-zinc-700 pl-4">
            <Link href="/bank">
              <div>
                <div className="text-[10px] text-zinc-500">Cash</div>
                <div className="font-mono text-emerald-400">${formatNum(cash)}</div>
              </div>
            </Link>
            <Link href="/journey" className="text-[10px] text-red-400 hover:underline ml-2">Help/Journey →</Link>
            <div>
              <div className="text-[10px] text-zinc-500">Bank</div>
              <div className="font-mono text-emerald-300">${formatNum(player.personal_bank || 0)}</div>
            </div>
            {diamonds > 0 && (
              <div>
                <div className="text-[10px] text-zinc-500">Diamonds</div>
                <div className="font-mono text-yellow-400">{formatNum(diamonds)} 💎</div>
              </div>
            )}
            <div>
              <div className="text-[10px] text-zinc-500">Power</div>
              <div className="font-mono text-white font-semibold">{formatNum(power)}</div>
            </div>

            {protection > 0 && (
              <div className="text-xs text-blue-400 pt-2">🛡️+{protection}</div>
            )}
            {heat >= 75 ? (
              <div className="text-[9px] px-1.5 py-0.5 bg-red-600 text-white rounded font-bold tracking-wide pt-0 self-center">🚨 MOST WANTED {heat}</div>
            ) : heat > 30 ? (
              <div className="text-[10px] text-red-400 pt-2">🔥{heat}</div>
            ) : null}
          </div>

          {/* Family */}
          <div className="text-xs text-zinc-400 min-w-[100px]">
            {familyStatus?.family_name ? (
              <span>{familyStatus.family_tag} — {familyStatus.family_name}</span>
            ) : (
              <span className="text-zinc-600">No Family</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
