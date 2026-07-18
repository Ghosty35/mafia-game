'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const DRUGS = ['Coke', 'Weed', 'Meth', 'Pills'] as const;
type Drug = typeof DRUGS[number];

const DRUG_META: Record<Drug, { icon: string; color: string }> = {
  Coke: { icon: '❄️', color: 'text-zinc-100' },
  Weed: { icon: '🌿', color: 'text-emerald-400' },
  Meth: { icon: '💊', color: 'text-blue-400' },
  Pills: { icon: '💉', color: 'text-rose-400' },
};

type CityRow = { city: string } & Record<Drug, number>;

function useCountdown(target: number) {
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));
  useEffect(() => {
    const iv = setInterval(() => setLeft(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [target]);
  return left;
}

const fmtCountdown = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
};

export default function DrugMarketBoard({ currentCity }: { currentCity: string }) {
  const { t, fm } = useLanguage();
  const [rows, setRows] = useState<CityRow[]>([]);
  const [rotatesAt, setRotatesAt] = useState<number>(0);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_all_drug_prices');
    if (data) {
      setRows((data.cities ?? []) as CityRow[]);
      if (data.rotates_at) setRotatesAt(new Date(data.rotates_at).getTime());
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(iv);
  }, []);

  const left = useCountdown(rotatesAt);

  // Best (highest = best to SELL) and lowest (best to BUY) per drug.
  const extremes = useMemo(() => {
    const out: Record<Drug, { min: number; max: number }> = {} as never;
    for (const d of DRUGS) {
      const vals = rows.map((r) => r[d]).filter((v) => typeof v === 'number');
      out[d] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return out;
  }, [rows]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div>
          <div className="text-sm font-semibold text-amber-400">📊 {t('dealer_market_title')}</div>
          <div className="text-[11px] text-zinc-500">{t('dealer_market_sub')}</div>
        </div>
        <div className="text-right shrink-0">
          {rotatesAt > 0 && (
            <div className="text-[11px] text-zinc-400">
              {t('dealer_rotates_in')} <span className="font-mono text-amber-400">{fmtCountdown(left)}</span>
            </div>
          )}
          <div className="text-xs text-zinc-500">{open ? '▲' : '▼'}</div>
        </div>
      </button>

      {open && (
        <div className="px-2 pb-3 overflow-x-auto">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left font-medium px-2 py-1.5">{t('dealer_city_col')}</th>
                {DRUGS.map((d) => (
                  <th key={d} className="text-right font-medium px-2 py-1.5">
                    {DRUG_META[d].icon} {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const here = r.city === currentCity;
                return (
                  <tr key={r.city} className={`border-t border-zinc-800 ${here ? 'bg-amber-950/20' : ''}`}>
                    <td className="px-2 py-1.5 font-medium">
                      {r.city}
                      {here && <span className="text-[9px] text-amber-400 ml-1">{t('dealer_you_here')}</span>}
                    </td>
                    {DRUGS.map((d) => {
                      const v = r[d];
                      const isMax = v === extremes[d]?.max;
                      const isMin = v === extremes[d]?.min;
                      return (
                        <td
                          key={d}
                          className={`px-2 py-1.5 text-right font-mono ${
                            isMax ? 'text-emerald-400 font-bold' : isMin ? 'text-red-400' : 'text-zinc-300'
                          }`}
                          title={isMax ? t('dealer_best_sell') : isMin ? t('dealer_best_buy') : ''}
                        >
                          {fm(v)}
                          {isMax && ' ▲'}
                          {isMin && ' ▼'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-zinc-500 px-2 pt-2">
            <span className="text-emerald-400">▲ {t('dealer_best_sell')}</span>{' · '}
            <span className="text-red-400">▼ {t('dealer_best_buy')}</span>{' — '}
            {t('dealer_market_note')}
          </p>
        </div>
      )}
    </div>
  );
}
