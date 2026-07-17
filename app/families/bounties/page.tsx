'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';

type Bounty = {
  id: string;
  target: string;
  target_city: string;
  amount: number;
  created_at: string;
  expires_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
};

type MyBounty = {
  has_bounty: boolean;
  amount?: number;
  expires_at?: string;
  family_name?: string;
  family_tag?: string;
};

export const dynamic = 'force-dynamic';

// Bounty board (077): who walked out on us, what they're worth, and whether
// there's a price on our own head. Collecting isn't a button here — you
// collect by landing a rip or a hit while the bounty is live.
export default function BountiesPage() {
  const { t, fm } = useLanguage();
  const { player } = usePlayer();

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [mine, setMine] = useState<MyBounty | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const supabase = createClient();

  const load = useCallback(async () => {
    const [listRes, mineRes] = await Promise.all([
      supabase.rpc('get_family_bounties'),
      supabase.rpc('get_my_bounty'),
    ]);
    setBounties(Array.isArray(listRes.data) ? listRes.data : []);
    setMine((mineRes.data as MyBounty) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000); // update every minute
    return () => clearInterval(tick);
  }, []);

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000));
  const open = bounties.filter((b) => !b.claimed_by);
  const collected = bounties.filter((b) => b.claimed_by);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🎯 {t('bo_title')}</h1>
        <p className="text-xs text-zinc-400">{t('bo_subtitle')}</p>
      </div>

      {/* Price on my own head */}
      {mine?.has_bounty && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3">
          <div className="text-sm text-red-300 font-semibold mb-0.5">
            🩸 {t('bo_on_you_title', { amount: fm(mine.amount ?? 0) })}
          </div>
          <div className="text-xs text-red-200/80">
            {t('bo_on_you_text', { family: mine.family_name ?? '', days: daysLeft(mine.expires_at ?? '') })}
          </div>
        </div>
      )}

      {/* Open contracts */}
      <Panel title={t('bo_open_title')} icon="🎯" bodyClassName="p-0">
        {open.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('bo_none_open')}</div>
        ) : (
          <>
            <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <div className="col-span-4">{t('bo_col_target')}</div>
              <div className="col-span-3">{t('bo_col_city')}</div>
              <div className="col-span-3 text-right">{t('bo_col_worth')}</div>
              <div className="col-span-2 text-right">{t('bo_col_expires')}</div>
            </div>
            {open.map((b) => (
              <div key={b.id} className="grid grid-cols-12 px-4 py-2.5 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
                <div className="col-span-4 truncate">
                  <Link href={`/profile?user=${encodeURIComponent(b.target)}`} className="font-medium hover:text-red-400">
                    🎯 {b.target}
                  </Link>
                </div>
                <div className="col-span-3 text-xs text-zinc-400">🏙️ {b.target_city}</div>
                <div className="col-span-3 text-right font-mono text-amber-400 tabular-nums text-sm">{fm(b.amount)}</div>
                <div className="col-span-2 text-right text-xs text-zinc-500">{t('bo_days', { days: daysLeft(b.expires_at) })}</div>
              </div>
            ))}
          </>
        )}
      </Panel>

      {/* How to collect */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400">
        <span className="text-white font-semibold">{t('bo_how_title')}</span> {t('bo_how_text')}
      </div>

      {/* Recently collected */}
      {collected.length > 0 && (
        <Panel title={t('bo_collected_title')} icon="✅" bodyClassName="p-0">
          {collected.map((b) => (
            <div key={b.id} className="border-t first:border-t-0 border-zinc-800 px-4 py-2 flex items-center justify-between text-xs hover:bg-zinc-800/40">
              <span className="text-zinc-400">
                <span className="text-emerald-400 font-medium">{b.claimed_by}</span> {t('bo_collected_on', { target: b.target })}
              </span>
              <span className="font-mono text-emerald-400">{fm(b.amount)}</span>
            </div>
          ))}
        </Panel>
      )}

      <div className="flex gap-3 text-xs">
        <Link href="/families" className="text-red-400 hover:underline">👥 {t('menu_my_family')}</Link>
        <Link href="/families/leave" className="text-red-400 hover:underline">🚪 {t('lv_title')}</Link>
      </div>
    </div>
  );
}
