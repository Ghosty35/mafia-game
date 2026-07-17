'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';

type Entry = { pos: number; username: string; amount: number; is_donator: boolean };
type Board = {
  total_pool: number;
  contributors: number;
  highest: { username: string; amount: number } | null;
  lowest: { username: string; amount: number } | null;
  me: { username: string; amount: number; rank: number | null } | null;
  top: Entry[];
};

export const dynamic = 'force-dynamic';

// Tax Bank Leaderboard (078): who actually pays their bills. Ranks players by
// lifetime tax contributions (property bills + voluntary deposits), with the
// three headline numbers the bug-inspectie asked for.
export default function TaxBankPage() {
  const { t, fm } = useLanguage();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_tax_leaderboard', { p_limit: 25 });
      if (data) setBoard(data as Board);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  if (!board) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('tb_unavailable')}</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🏛️ {t('tb_title')}</h1>
        <p className="text-xs text-zinc-400">{t('tb_subtitle')}</p>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-amber-900/50 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tb_pool')}</div>
          <div className="font-mono font-bold text-2xl text-amber-400 tabular-nums">{fm(board.total_pool)}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{t('tb_contributors', { count: board.contributors })}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tb_highest')}</div>
          <div className="font-mono font-bold text-lg text-emerald-400 tabular-nums">{fm(board.highest?.amount ?? 0)}</div>
          <div className="text-[10px] text-zinc-400 mt-0.5 truncate">{board.highest?.username ?? '—'}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tb_lowest')}</div>
          <div className="font-mono font-bold text-lg text-zinc-300 tabular-nums">{fm(board.lowest?.amount ?? 0)}</div>
          <div className="text-[10px] text-zinc-400 mt-0.5 truncate">{board.lowest?.username ?? '—'}</div>
        </div>
      </div>

      {/* Where I stand */}
      {board.me && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-zinc-400">
            {board.me.rank
              ? t('tb_me_ranked', { rank: board.me.rank, amount: fm(board.me.amount) })
              : t('tb_me_unranked')}
          </span>
          <Link href="/post-office" className="text-xs text-red-400 hover:underline shrink-0">📮 {t('menu_post_office')}</Link>
        </div>
      )}

      {/* Board */}
      <Panel title={t('tb_board_title')} icon="🏛️" bodyClassName="p-0">
        {board.top.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('tb_empty')}</div>
        ) : (
          <>
            <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <div className="col-span-2 text-center">#</div>
              <div className="col-span-6">{t('lb_col_name')}</div>
              <div className="col-span-4 text-right">{t('tb_col_paid')}</div>
            </div>
            {board.top.map((e) => (
              <div
                key={e.username}
                className={`grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40 ${
                  board.me?.username === e.username ? 'bg-amber-950/20' : ''
                }`}
              >
                <div className="col-span-2 text-center font-mono text-red-500 font-semibold text-xs">#{e.pos}</div>
                <div className="col-span-6 truncate">
                  <Link href={`/profile?user=${encodeURIComponent(e.username)}`} className="font-medium hover:text-red-400">
                    {e.username}
                  </Link>
                  {e.is_donator && (
                    <span className="ml-1.5 text-[9px] px-1 py-px bg-amber-500 text-black rounded font-bold align-middle">VIP</span>
                  )}
                </div>
                <div className="col-span-4 text-right font-mono text-amber-400 tabular-nums text-xs">{fm(e.amount)}</div>
              </div>
            ))}
          </>
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('tb_footer')}</div>
    </div>
  );
}
