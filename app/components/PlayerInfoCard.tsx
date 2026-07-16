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

// A labelled progress bar (left column of the stats header).
function StatBar({ label, pct, valueText, color }: { label: string; pct: number; valueText: string; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-400">{valueText}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-2 transition-all ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

export default function PlayerInfoCard({ player: propPlayer, familyStatus: propFamily }: PlayerInfoCardProps) {
  const { t, language } = useLanguage();
  const context = usePlayer();
  const player = propPlayer || context.player;
  const [familyStatus, setFamilyStatus] = useState(propFamily || null);
  const [serverTime, setServerTime] = useState(''); // client-only, avoids SSR hydration mismatch

  // Live server clock (Europe/Amsterdam), set only on the client.
  useEffect(() => {
    const tick = () => {
      setServerTime(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Amsterdam',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

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
    return <div className="card p-3 mb-4 animate-pulse h-24 bg-zinc-900 border border-zinc-800" />;
  }

  const health = player.health ?? 100;
  const level = player.level ?? 1;
  const xp = player.xp ?? 0;
  const murderSkill = player.murder_skill ?? 0;
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
  const mostWanted = heat >= 75;

  const formatNum = (n: number) =>
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));

  return (
    <div className="mb-4">
      <div className="card border border-zinc-700 bg-zinc-900/90 overflow-hidden">
        {/* Header row: identity + rank + heat status */}
        <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2 bg-gradient-to-r from-zinc-900 to-zinc-950 border-b border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`font-bold text-base truncate ${player.is_donator ? 'text-yellow-400' : ''}`}>
              {player.username || 'Unknown'}
            </span>
            {player.is_donator && (
              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-black rounded font-bold shrink-0">DONATOR</span>
            )}
            {familyStatus?.family_tag && (
              <span className="text-[10px] px-1.5 py-px rounded bg-red-950 text-red-400 font-mono tracking-wider shrink-0">
                {familyStatus.family_tag}
              </span>
            )}
            <span className="text-[10px] text-amber-400 font-medium tracking-wide shrink-0">
              {rankName}
              {player.leaderboard_rank ? ` (#${player.leaderboard_rank})` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {protection > 0 && <span className="text-xs text-blue-400">🛡️+{protection}</span>}
            {mostWanted ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-red-600 text-white rounded font-bold tracking-wide animate-pulse">
                🚨 {t('pi_most_wanted')} {heat}
              </span>
            ) : (
              <span className={`text-[10px] font-mono ${heat >= 40 ? 'text-orange-400' : 'text-zinc-500'}`}>🔥 {heat}/100</span>
            )}
          </div>
        </div>

        {/* Body: bars (left) + resources (right) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 px-4 py-3">
          {/* Left: progress bars */}
          <div className="space-y-2">
            <StatBar
              label={t('pi_rank_progress')}
              pct={expProgress}
              valueText={`${expProgress}% · Lvl ${level}`}
              color="bg-red-600"
            />
            <StatBar label={t('pi_life')} pct={health} valueText={`${health}%`}
              color={health > 60 ? 'bg-emerald-500' : health > 30 ? 'bg-yellow-500' : 'bg-red-500'} />
            <StatBar label={t('pi_murder_xp')} pct={murderProgress} valueText={`${murderSkill.toFixed(2)}`} color="bg-purple-500" />
          </div>

          {/* Right: resources */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm content-start">
            <Link href="/bank" className="flex items-center justify-between gap-2 hover:text-emerald-300">
              <span className="text-[11px] text-zinc-500">💵 {t('pi_cash')}</span>
              <span className="font-mono text-emerald-400">${formatNum(cash)}</span>
            </Link>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">🏦 {t('pi_bank')}</span>
              <span className="font-mono text-emerald-300">${formatNum(player.personal_bank || 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">💎 {t('pi_diamonds')}</span>
              <span className="font-mono text-yellow-400">{formatNum(diamonds)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">⚡ {t('pi_power')}</span>
              <span className="font-mono text-white font-semibold">{formatNum(power)}</span>
            </div>
            <Link href="/messages" className="flex items-center justify-between gap-2 hover:text-red-300">
              <span className="text-[11px] text-zinc-500">✉️ {t('pi_messages')}</span>
              <span className="font-mono text-red-400">→</span>
            </Link>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">🕐 {t('pi_server_time')}</span>
              <span className="font-mono text-zinc-300 tabular-nums" suppressHydrationWarning>{serverTime || '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
