'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../components/Panel';

type CasinoPools = { blackjack: number; roulette: number; lottery: number; general: number };

export const dynamic = 'force-dynamic';

// Casino hub. Every game here is a real, server-dealt standalone (079/080) —
// the old floor also had a "quick play" that was a coin flip dressed up with a
// client-side random roulette number; that's gone. Pools are live from
// get_casino_pools (they grow from real losing bets), never hardcoded.
export default function CasinoPage() {
  const { player } = usePlayer();
  const { t, fm } = useLanguage();
  const [pools, setPools] = useState<CasinoPools | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const fetchPools = async () => {
      const { data } = await supabase.rpc('get_casino_pools');
      if (data) setPools(data as CasinoPools);
    };
    fetchPools();
    const iv = setInterval(fetchPools, 20000);
    return () => clearInterval(iv);
  }, []);

  const games: Array<{ href: string; icon: string; label: TranslationKey; sub: TranslationKey }> = [
    { href: '/casino/blackjack', icon: '🃏', label: 'menu_blackjack', sub: 'bj_subtitle' },
    { href: '/casino/roulette', icon: '🎡', label: 'menu_roulette', sub: 'rl_subtitle' },
    { href: '/casino/poker', icon: '🎴', label: 'menu_poker', sub: 'vp_subtitle' },
    { href: '/casino/rps', icon: '✊', label: 'menu_rps', sub: 'rps_subtitle' },
  ];

  const poolCards: Array<{ label: TranslationKey; val: number; icon: string }> = pools
    ? [
        { label: 'casino_pool_blackjack', val: pools.blackjack, icon: '♠️' },
        { label: 'casino_pool_roulette', val: pools.roulette, icon: '🎡' },
        { label: 'casino_pool_lottery', val: pools.lottery, icon: '🎟️' },
        { label: 'casino_pool_general', val: pools.general, icon: '💰' },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🎰 {t('casino_title')}</h1>
          <p className="text-xs text-zinc-400">{t('casino_desc')}</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('casino_your_cash')}</div>
          <div className="font-mono text-emerald-400 text-sm">{fm(player?.cash ?? 0)}</div>
        </div>
      </div>

      {/* The tables */}
      <Panel title={t('casino_games_title')} icon="🃏" bodyClassName="p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {games.map((g) => (
            <Link key={g.href} href={g.href} className="card p-4 hover:border-red-700 transition flex flex-col">
              <div className="text-3xl mb-1">{g.icon}</div>
              <div className="font-bold text-sm">{t(g.label)}</div>
              <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">{t(g.sub)}</div>
            </Link>
          ))}
        </div>
        <Link
          href="/casino/lottery"
          className="mt-3 flex items-center justify-between bg-gradient-to-r from-amber-950/70 to-zinc-900 border border-amber-800/60 rounded-xl px-4 py-3 hover:border-amber-600 transition"
        >
          <div>
            <div className="font-bold text-amber-300">🎟️ {t('casino_weekly_lottery')}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">{t('casino_lottery_teaser')}</div>
          </div>
          <span className="text-amber-400 text-lg shrink-0">→</span>
        </Link>
      </Panel>

      {/* Live pools */}
      <Panel title={t('casino_pools_title')} icon="💰">
        {!pools ? (
          <div className="text-sm text-zinc-500">{t('loading')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {poolCards.map((p, i) => (
                <div key={i} className="bg-zinc-950 border border-amber-900/40 rounded-xl px-3 py-3">
                  <div className="text-[11px] text-amber-400">{p.icon} {t(p.label)}</div>
                  <div className="text-xl font-mono text-emerald-400 mt-1 tabular-nums">{fm(p.val)}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">{t('casino_pool_note')}</p>
          </>
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('casino_house_edge_note')}</div>
    </div>
  );
}
