'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';

type Entry = {
  username: string;
  level: number;
  rip_points: number;
  is_donator: boolean;
  family_tag: string | null;
};

export const dynamic = 'force-dynamic';

// Powerrip leaderboard (136): rip points are earned by MURDERING players and
// scale with the victim's combat worth — (level*10 + weapon + vest) x bullets
// multiplier. Killing unarmed rookies scores ~nothing; hunting armed tanks pays.
export default function PowerripPage() {
  const { t } = useLanguage();
  const { player } = usePlayer();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_rip_leaderboard', { p_limit: 50 });
      if (data) setEntries(data as Entry[]);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const myPoints = player?.rip_points ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">💀 {t('pr_title')}</h1>
        <p className="text-xs text-zinc-400">{t('pr_subtitle')}</p>
      </div>

      {/* How scoring works */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400 space-y-1">
        <div className="font-semibold text-zinc-300">{t('pr_formula_title')}</div>
        <div className="font-mono text-[11px] text-amber-400">{t('pr_formula')}</div>
        <div>{t('pr_formula_hint')}</div>
      </div>

      {/* Where I stand */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-zinc-400">{t('pr_my_points')}</span>
        <span className="font-mono font-bold text-red-400 tabular-nums">{myPoints.toLocaleString()}</span>
      </div>

      <Panel title={t('pr_board_title')} icon="💀" bodyClassName="p-0">
        {!entries || entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('pr_empty')}</div>
        ) : (
          <>
            <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <div className="col-span-2 text-center">#</div>
              <div className="col-span-5">{t('lb_col_name')}</div>
              <div className="col-span-2 text-center">{t('pr_col_level')}</div>
              <div className="col-span-3 text-right">{t('pr_col_points')}</div>
            </div>
            {entries.map((e, i) => (
              <div
                key={e.username}
                className={`grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40 ${
                  player?.username === e.username ? 'bg-red-950/20' : ''
                }`}
              >
                <div className="col-span-2 text-center font-mono text-red-500 font-semibold text-xs">#{i + 1}</div>
                <div className="col-span-5 truncate">
                  <Link href={`/profile?user=${encodeURIComponent(e.username)}`} className="font-medium hover:text-red-400">
                    {e.username}
                  </Link>
                  {e.family_tag && <span className="ml-1.5 text-[10px] text-zinc-500">[{e.family_tag}]</span>}
                  {e.is_donator && (
                    <span className="ml-1.5 text-[9px] px-1 py-px bg-amber-500 text-black rounded font-bold align-middle">VIP</span>
                  )}
                </div>
                <div className="col-span-2 text-center font-mono text-zinc-400 text-xs">{e.level}</div>
                <div className="col-span-3 text-right font-mono text-red-400 tabular-nums text-xs">
                  {Number(e.rip_points).toLocaleString()}
                </div>
              </div>
            ))}
          </>
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('pr_footer')}</div>
    </div>
  );
}
