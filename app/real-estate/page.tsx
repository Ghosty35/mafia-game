'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CITIES } from '@/lib/cities';
import PageHeader from '../components/PageHeader';

type CatalogProperty = {
  id: string;
  name: string;
  ptype: string;
  type: string;
  city: string;
  price: number;
  income: number;
  spots: number;
};

const CITY_COLORS: Record<string, { accent: string; bg: string }> = {
  'New York':     { accent: 'text-blue-400', bg: 'bg-blue-950/20' },
  'Chicago':      { accent: 'text-emerald-400', bg: 'bg-emerald-950/20' },
  'Los Angeles':  { accent: 'text-amber-400', bg: 'bg-amber-950/20' },
  'Miami':        { accent: 'text-pink-400', bg: 'bg-pink-950/20' },
  'Las Vegas':    { accent: 'text-purple-400', bg: 'bg-purple-950/20' },
};

export default function RealEstatePage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<CatalogProperty[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_property_catalog');
      if (error) {
        console.error('Failed to load property catalog:', error);
        return;
      }
      if (Array.isArray(data)) setCatalog(data as CatalogProperty[]);
    };
    load();
  }, []);

  if (!player) return <div className="p-6 text-zinc-400">{t('loading')}</div>;

  const currentCity = player.current_city || 'New York';
  const owned = player.owned_properties || [];

  // Group properties by city
  const byCity = catalog.reduce<Record<string, CatalogProperty[]>>((acc, p) => {
    if (!acc[p.city]) acc[p.city] = [];
    acc[p.city].push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title={t('re_title')}
        subtitle={t('re_desc')}
        icon="🏠"
        variant="default"
      />

      {/* Current City Quick Access */}
      <div className={`${CITY_COLORS[currentCity]?.bg || 'bg-zinc-900'} border border-zinc-800 rounded-xl p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-1">Your Current City</div>
            <div className={`text-xl font-bold ${CITY_COLORS[currentCity]?.accent || 'text-white'}`}>{currentCity}</div>
          </div>
          <Link href={`/real-estate/${encodeURIComponent(currentCity)}`} className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold transition-colors">
            View Properties →
          </Link>
        </div>
        <div className="text-xs text-zinc-400">
          You own <span className="text-amber-400 font-bold">{owned.length}</span> / 11 properties
        </div>
      </div>

      {/* City Selection Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Select a City</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {CITIES.map((c) => {
            const cityProps = byCity[c] || [];
            const isCurrent = c === currentCity;
            const colors = CITY_COLORS[c] || { accent: 'text-zinc-400', bg: 'bg-zinc-900' };
            return (
              <Link
                key={c}
                href={`/real-estate/${encodeURIComponent(c)}`}
                className={`${colors.bg} border ${isCurrent ? 'border-amber-700/50 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-zinc-800'} rounded-xl p-4 transition-all hover:border-zinc-700`}
              >
                <div className={`text-2xl mb-2 ${colors.accent}`}>📍</div>
                <div className="font-bold text-sm mb-1">{c}</div>
                <div className="text-[10px] text-zinc-500">{cityProps.length} properties</div>
                {isCurrent && <div className="text-[10px] text-amber-400 mt-1 font-semibold">CURRENT</div>}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Billing moved to Post Office */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">📮 {t('po_title')}</div>
          <div className="text-xs text-zinc-400">{t('re_billing_moved')}</div>
        </div>
        <Link href="/post-office" className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold shrink-0 transition-colors">
          {t('re_billing_go')}
        </Link>
      </div>
    </div>
  );
}
