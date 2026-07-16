'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import RipButton from './RipButton';
import type { TranslationKey } from '@/lib/i18n/translations';

type WantedEntry = {
  pos: number;
  username: string;
  heat: number;
  level: number;
  dirty_cash: number;
  city: string | null;
  is_donator: boolean;
  family_tag: string | null;
};

function heatBadge(heat: number): { labelKey: TranslationKey; cls: string } {
  if (heat >= 75) return { labelKey: 'pi_most_wanted', cls: 'bg-red-600 text-white' };
  if (heat >= 40) return { labelKey: 'mw_st_wanted', cls: 'bg-orange-600/80 text-white' };
  if (heat >= 20) return { labelKey: 'mw_st_watched', cls: 'bg-yellow-600/70 text-black' };
  if (heat > 0) return { labelKey: 'mw_st_cooling', cls: 'bg-zinc-700 text-zinc-200' };
  return { labelKey: 'mw_st_clean', cls: 'bg-zinc-800 text-zinc-400' };
}

export default function MostWantedBoard({ limit = 25, compact = false }: { limit?: number; compact?: boolean }) {
  const { language, t } = useLanguage();
  const [rows, setRows] = useState<WantedEntry[]>([]);
  const [me, setMe] = useState<{ pos: number; heat: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No unmount guard: in dev StrictMode the double-mount can otherwise
    // discard the resolving fetch and leave the board stuck on "Loading".
    // A late setState after unmount is a harmless no-op in React 18.
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_most_wanted', { limit_count: limit });
      if (data) {
        setRows((data.top ?? []) as WantedEntry[]);
        setMe((data.me ?? null) as { pos: number; heat: number } | null);
      }
      setLoading(false);
    };
    load();
    const poll = setInterval(load, 20000);
    return () => clearInterval(poll);
  }, [limit]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
      <div className="bg-gradient-to-r from-red-950 to-zinc-900 px-4 py-2 flex items-center justify-between">
        <h2 className="font-bold tracking-tight flex items-center gap-2">🚨 {t('menu_most_wanted')}</h2>
        <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{t('mw_ranked_by_heat')}</span>
      </div>

      {/* header */}
      <div className="grid grid-cols-12 bg-zinc-800 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
        <div className="col-span-1 text-center">#</div>
        <div className="col-span-4">{t('mw_col_criminal')}</div>
        <div className="col-span-3">{t('mw_col_status')}</div>
        <div className="col-span-2 text-right">{t('mw_col_heat')}</div>
        {!compact && <div className="col-span-2 text-right">🩸 {t('mw_col_dirty')}</div>}
      </div>

      {loading ? (
        <div className="p-8 text-center text-zinc-500 text-sm">{t('mw_loading')}</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-zinc-500 text-sm">{t('mw_empty')}</div>
      ) : (
        rows.map((r) => {
          const badge = heatBadge(r.heat);
          const isMe = me != null && r.pos === me.pos;
          return (
            <div
              key={r.username}
              className={`grid grid-cols-12 px-3 py-1.5 border-t border-zinc-800 items-center hover:bg-zinc-800/60 transition-all ${
                isMe ? 'bg-red-950/20' : ''
              }`}
            >
              <div className="col-span-1 text-center font-mono text-red-500 font-semibold text-xs">#{r.pos}</div>
              <div className="col-span-4 font-medium truncate pr-2 flex items-center gap-1 min-w-0">
                <Link href={`/profile?user=${r.username}`} className="hover:underline text-red-400 truncate">
                  {r.username}
                </Link>
                {r.is_donator && <span className="text-[8px] px-1 py-0.5 bg-amber-500 text-black rounded font-bold align-middle shrink-0">D</span>}
                {r.family_tag && <span className="text-[9px] text-zinc-500 font-mono shrink-0">[{r.family_tag}]</span>}
                {!isMe && <span className="shrink-0"><RipButton targetUsername={r.username} /></span>}
              </div>
              <div className="col-span-3">
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide ${badge.cls}`}>{t(badge.labelKey)}</span>
              </div>
              <div className="col-span-2 text-right font-mono font-semibold text-orange-400 tabular-nums">
                🔥 {r.heat}
              </div>
              {!compact && (
                <div className="col-span-2 text-right font-mono text-red-400 tabular-nums">
                  {formatCash(r.dirty_cash ?? 0, language)}
                </div>
              )}
            </div>
          );
        })
      )}

      {me && (
        <p className="px-3 py-2 text-center text-[10px] text-zinc-400 border-t border-zinc-800">
          {t('mw_your_spot')}: <span className="text-red-400 font-semibold">#{me.pos}</span> · {t('mw_heat_word')}{' '}
          <span className="text-orange-400 font-semibold">{me.heat}</span>
        </p>
      )}
    </div>
  );
}
