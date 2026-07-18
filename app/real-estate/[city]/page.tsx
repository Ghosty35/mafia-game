'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { usePlayer } from '../../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { City } from '@/lib/cities';
import type { OwnedProperty } from '@/lib/types';
import PropertyImage from '../../components/PropertyImage';

// Property display metadata with mafia-themed icons
const PROPERTY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  ts1:        { icon: '🚉', color: 'text-zinc-300', bg: 'bg-zinc-800/50' },
  house1:     { icon: '🏠', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  mf1:        { icon: '🏭', color: 'text-orange-400', bg: 'bg-orange-950/30' },
  villa1:     { icon: '🏛️', color: 'text-amber-400', bg: 'bg-amber-950/30' },
  da1:        { icon: '🕵️', color: 'text-blue-400', bg: 'bg-blue-950/30' },
  house_la:   { icon: '🏠', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  h1:         { icon: '🏥', color: 'text-red-400', bg: 'bg-red-950/30' },
  villa_mi:   { icon: '🏛️', color: 'text-amber-400', bg: 'bg-amber-950/30' },
  gb1:        { icon: '🏦', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  mansion1:   { icon: '💎', color: 'text-amber-300', bg: 'bg-amber-950/40' },
  house_chi:  { icon: '🏠', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  mansion_la: { icon: '💎', color: 'text-amber-300', bg: 'bg-amber-950/40' },
  house_mi:   { icon: '🏠', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  villa_lv:   { icon: '🏛️', color: 'text-amber-400', bg: 'bg-amber-950/30' },
};

const PTYPE_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  house:     { icon: '🏠', color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  villa:     { icon: '🏛️', color: 'text-amber-400', bg: 'bg-amber-950/30' },
  mansion:   { icon: '💎', color: 'text-amber-300', bg: 'bg-amber-950/40' },
  agency:    { icon: '🏢', color: 'text-zinc-300', bg: 'bg-zinc-800/50' },
  airport:   { icon: '✈️', color: 'text-sky-400', bg: 'bg-sky-950/30' },
  casino:    { icon: '🎰', color: 'text-purple-400', bg: 'bg-purple-950/30' },
  tuneshop:  { icon: '🔧', color: 'text-orange-400', bg: 'bg-orange-950/30' },
  redlight:  { icon: '🌃', color: 'text-pink-400', bg: 'bg-pink-950/30' },
};

const getIcon = (id: string, ptype?: string) => PROPERTY_ICONS[id] || (ptype ? PTYPE_ICONS[ptype] : undefined) || { icon: '🏢', color: 'text-zinc-300', bg: 'bg-zinc-900' };

type Property = {
  id: string;
  name: string;
  ptype: string;
  type: string;
  city: string;
  price: number;
  income: number;
  spots: number;
};

export default function CityRealEstatePage() {
  const params = useParams();
  const city = (params?.city as City) || 'New York';
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [catalog, setCatalog] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoadError(null);
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_property_catalog', { p_city: city });
      if (error) {
        console.error(`Failed to load properties for ${city}:`, error);
        setLoadError(error.message || t('re_load_failed'));
      } else if (Array.isArray(data)) {
        setCatalog(data as Property[]);
      }
      setLoading(false);
    };
    load();
  }, [city, showToast, t]);

  // Keyboard shortcut: Esc returns to the city overview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.push('/real-estate');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const getTax = (prop: Property) => Math.floor(prop.price * 0.1);

  const buyProperty = async (prop: Property) => {
    if (!player) return;
    const tax = getTax(prop);
    if (player.cash < prop.price + tax) {
      showToast(t('re_no_cash_tax'));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('purchase_property', {
      p_catalog_id: prop.id,
      p_custom_name: prop.name,
    });
    setBusy(false);
    if (error) {
      const m = error.message || '';
      if (m.includes('NOT_ENOUGH_CASH')) showToast(t('re_no_cash_tax'));
      else if (m.includes('PROPERTY_LIMIT_REACHED')) showToast(t('re_total_limit'));
      else if (m.includes('ALREADY_OWNED')) showToast(t('re_house_in_city'));
      else if (m.includes('WRONG_CITY')) showToast(t('re_city_only', { city: prop.city }));
      else showToast(m || t('re_purchase_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(t('re_bought', { name: prop.name, city: prop.city, price: fm(prop.price), tax: fm(data?.tax ?? tax) }));
  };

  const sellProperty = async (prop: Property) => {
    if (!player) return;
    if (!confirm(t('re_sell_confirm', { name: prop.name, refund: fm(Math.floor(prop.price * 0.5)) }))) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('sell_property', {
      p_prop_id: prop.id,
    });
    setBusy(false);
    if (error) {
      const m = error.message || '';
      if (m.includes('LAUNDER_ACTIVE')) showToast(t('re_sell_launder_active'));
      else showToast(m || t('re_sell_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(t('re_sold', { name: prop.name, refund: fm(data?.refund ?? 0) }));
  };

  const getMaintenance = (prop: Property) => Math.floor(prop.income * 0.12);
  const getProfit = (prop: Property) => prop.income - getMaintenance(prop);

  const owned: OwnedProperty[] = player?.owned_properties || [];
  const ownedIds = new Set(owned.map((p) => p?.catalog_id || p?.id));
  const isAtTotalCap = owned.length >= 4;
  const isPtypeMaxed = (ptype: string) => {
    const target = ptype.toLowerCase();
    const count = owned.filter((p) => (p?.ptype || p?.name || '').toLowerCase() === target).length;
    if (target === 'mansion') return count >= 1;
    if (target === 'villa') return count >= 2;
    if (target === 'house') return count >= 4;
    return false;
  };

  if (!player) return <div className="p-6 text-zinc-400">{t('loading')}</div>;

  const categoryOf = (ptype: string) => {
    const p = ptype.toLowerCase();
    if (p === 'house' || p === 'villa' || p === 'mansion') return 'residential';
    if (p === 'agency' || p === 'airport' || p === 'casino' || p === 'tuneshop' || p === 'redlight')
      return 'business';
    return 'other';
  };

  const sections: { key: string; label: string; items: Property[] }[] = [
    { key: 'residential', label: t('re_section_residential'), items: [] },
    { key: 'business', label: t('re_section_business'), items: [] },
    { key: 'other', label: t('re_section_other'), items: [] },
  ];
  for (const prop of catalog) {
    const cat = categoryOf(prop.ptype);
    sections.find((s) => s.key === cat)?.items.push(prop);
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/real-estate" className="text-amber-400 hover:text-amber-300 text-sm">← {t('common_back')}</Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🏠 {city}</h1>
          <p className="text-xs text-zinc-400">{t('re_city_only', { city })}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">{t('loading')}</div>
      ) : loadError ? (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-xl p-4">{loadError}</div>
      ) : catalog.length === 0 ? (
        <div className="text-sm text-amber-400">{t('re_none', { city })}</div>
      ) : (
        sections
          .filter((s) => s.items.length > 0)
          .map((section) => (
            <div key={section.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{section.label}</h2>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5">{section.items.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.items.map((prop) => {
                  const meta = getIcon(prop.id, prop.ptype);
                  const tax = getTax(prop);
                  const maint = getMaintenance(prop);
                  const profit = getProfit(prop);
                  const isOwned = ownedIds.has(prop.id) || owned.some(o => o.name === prop.name && o.city === prop.city);
                  const blocked = isOwned || isAtTotalCap || isPtypeMaxed(prop.ptype);
                  const cantAfford = player.cash < prop.price + tax;

                  return (
                    <div key={prop.id} className={`${meta.bg} border border-zinc-800 rounded-xl p-5 transition-all hover:border-zinc-700`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-12 h-12 rounded-lg ${meta.bg} border border-zinc-700 flex items-center justify-center overflow-hidden`}>
                          <PropertyImage catalogId={prop.id} ptype={prop.ptype} name={prop.name} size={48} />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm">{prop.name}</h3>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{prop.ptype} • {prop.type}</div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs mb-4">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">{t('re_purchase')}</span>
                          <span className="font-mono text-white">{fm(prop.price)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">{t('re_tax')}</span>
                          <span className="font-mono text-red-400">+{fm(tax)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">{t('re_avg_income')}</span>
                          <span className="font-mono text-emerald-400">+{fm(prop.income)}/hr</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">{t('re_avg_maint')}</span>
                          <span className="font-mono text-red-400">-{fm(maint)}/hr</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-zinc-800">
                          <span className="text-zinc-300 font-semibold">{t('re_avg_profit')}</span>
                          <span className="font-mono text-emerald-400 font-bold">+{fm(profit)}/hr</span>
                        </div>
                        {prop.spots > 0 && (
                          <div className="text-[10px] text-zinc-500">{t('re_spots_note', { spots: prop.spots })}</div>
                        )}
                      </div>

                      <button
                        onClick={() => isOwned ? sellProperty(prop) : buyProperty(prop)}
                        disabled={busy || (isOwned ? false : (blocked || cantAfford))}
                        className={`w-full py-2 rounded-lg text-xs font-semibold transition-all ${
                          isOwned
                            ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                            : blocked
                              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                              : cantAfford
                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                : 'bg-red-700 hover:bg-red-600 text-white'
                        }`}
                      >
                        {isOwned
                          ? t('common_sell')
                          : isAtTotalCap
                            ? t('re_total_limit')
                            : isPtypeMaxed(prop.ptype)
                              ? 'MAX ' + prop.ptype.toUpperCase()
                              : cantAfford
                                ? t('re_no_cash_tax')
                                : t('re_buy_button', { name: prop.name })}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
