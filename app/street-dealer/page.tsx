'use client';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { CITIES, City } from '@/lib/cities';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import HeatManager from '../components/HeatManager';
import DrugMarketBoard from '../components/DrugMarketBoard';
import { useEconomy } from '@/lib/economy';

const DRUGS = ['Coke', 'Weed', 'Meth', 'Pills'] as const;

type DrugPrices = Record<typeof DRUGS[number], number>;

export default function StreetDealerPage() {
  const { player, refreshPlayer, canPerformAction, recordAction, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const economy = useEconomy();
  const [prices, setPrices] = useState<DrugPrices>({ Coke: 0, Weed: 0, Meth: 0, Pills: 0 });
  const [city, setCity] = useState<City>('New York');
  const [drugStorage, setDrugStorage] = useState<Record<string, number>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({}); // for timers like murder, grow
  const [buyQty, setBuyQty] = useState(1);
  const [sellQty, setSellQty] = useState(1);

  const drugMeta: Record<string, { icon: string; color: string; bg: string; border: string; label: string }> = {
    Coke:    { icon: '❄️', color: 'text-zinc-100', bg: 'bg-zinc-100/5', border: 'border-zinc-400/30', label: 'Cocaine' },
    Weed:    { icon: '🌿', color: 'text-emerald-400', bg: 'bg-emerald-950/30', border: 'border-emerald-900/40', label: 'Weed' },
    Meth:    { icon: '💊', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/40', label: 'Meth' },
    Pills:   { icon: '💉', color: 'text-rose-400', bg: 'bg-rose-950/30', border: 'border-rose-900/40', label: 'Pills' },
  };

  const currentCity = (player?.current_city as City) || 'New York';

  // Load live storage and cooldowns
  useEffect(() => {
    if (!player) return;
    const loadData = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_drug_storage');
      if (data) setDrugStorage(data as any);
      // Load murder cooldown etc if in player
      if (player.murder_cooldown) {
        const end = new Date(player.murder_cooldown).getTime();
        const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
        setCooldowns(prev => ({...prev, murder: left}));
      }
    };
    loadData();
  }, [player]);

  // Load server-authoritative prices (identical for all players in the
  // current 4h window) so the UI shows exactly what the server will charge.
  useEffect(() => {
    const loadPrices = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_drug_prices', { p_city: currentCity });
      if (data) {
        const { Coke, Weed, Meth, Pills } = data as DrugPrices & { city: string };
        setPrices({ Coke, Weed, Meth, Pills });
      }
    };
    loadPrices();
    // Refresh once an hour so the 4h window rollover is picked up.
    const iv = setInterval(loadPrices, 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, [currentCity]);

  // Live countdown for cooldowns
  useEffect(() => {
    const iv = setInterval(() => {
      setCooldowns(prev => {
        const next: any = {};
        Object.keys(prev).forEach(k => {
          next[k] = Math.max(0, prev[k] - 1);
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const buyDrug = async (drug: typeof DRUGS[number], qty?: number) => {
    const amount = qty || buyQty;
    if (!player || amount < 1) return;
    if (!canPerformAction()) {
      showToast(t('dealer_wait'), 'error');
      return;
    }
    recordAction();
    // Server computes price, tax and cap — client can no longer fake them.
    const supabase = createClient();
    const { data, error } = await supabase.rpc('buy_drug', { p_drug: drug, p_qty: amount });
    if (error) {
      const msg = error.message || '';
      const cap = economy?.drug_caps?.[drug] ?? 0;
      showToast(
        msg.includes('NOT_ENOUGH_CASH') ? t('dealer_no_cash_tax')
          : msg.includes('CAP_REACHED') ? t('dealer_cap_reached', { drug, cap })
          : (msg || t('dealer_purchase_failed')),
        'error',
      );
      return;
    }
    const res = data as { total: number; storage: Record<string, number> };
    if (res?.storage) setDrugStorage(res.storage);
    if (refreshPlayer) await refreshPlayer(); await router.refresh();
    showToast(t('dealer_bought', { amount, drug, total: fm(res?.total ?? 0) }), 'success');
  };

  const sellDrug = async (drug: typeof DRUGS[number], qty: number) => {
    if (!player || qty < 1) return;
    if ((drugStorage[drug] || 0) < qty) {
      showToast(t('dealer_not_enough_shed'), 'error');
      return;
    }
    // Server computes revenue at the authoritative price.
    const supabase = createClient();
    const { data, error } = await supabase.rpc('sell_drug', { p_drug: drug, p_qty: qty });
    if (error) {
      const msg = error.message || '';
      showToast(msg.includes('NOT_ENOUGH_STOCK') ? t('dealer_not_enough_shed') : (msg || t('dealer_sale_failed')), 'error');
      return;
    }
    const res = data as { revenue: number; storage: Record<string, number> };
    if (res?.storage) setDrugStorage(res.storage);
    if (refreshPlayer) await refreshPlayer(); await router.refresh();
    showToast(t('dealer_sold', { qty, drug, revenue: fm(res?.revenue ?? 0) }), 'success');
  };

  if (!player) return <div>{t('loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">💊 {t('dealer_title', { city: currentCity })}</h1>
        <p className="text-xs text-zinc-400">{t('dealer_desc')}</p>
      </div>

      {/* Dynamic market: prices rotate between cities every 4h */}
      <DrugMarketBoard currentCity={currentCity} />

      {/* Heat-reduction items (also sold here on the street) */}
      <HeatManager variant="store" />

      {/* Live Drug Storage Tracker */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-sm font-semibold mb-2 text-amber-400">{t('dealer_storage_title')}</div>
        <div className="flex flex-wrap gap-4 text-xs">
          {DRUGS.map(d => {
            const meta = drugMeta[d];
            return (
              <span key={d} className={`px-3 py-1.5 rounded-lg border ${meta.bg} ${meta.border}`}>
                <span className="mr-1">{meta.icon}</span>
                {d}: <span className={`font-mono font-bold ${meta.color}`}>{drugStorage[d] || 0} kg</span>
                <span className="text-zinc-500">/ {economy?.drug_caps?.[d] ?? '—'}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Quantity controls — bulk buy/sell instead of spam-clicking */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400 w-16">Buy qty</span>
            <input
              type="number"
              min={1}
              value={buyQty}
              onChange={(e) => setBuyQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-amber-700"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400 w-16">Sell qty</span>
            <input
              type="number"
              min={1}
              value={sellQty}
              onChange={(e) => setSellQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-amber-700"
            />
          </label>
        </div>
      </div>

      {/* Drug Market Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {DRUGS.map(drug => {
          const meta = drugMeta[drug];
          return (
            <div key={drug} className={`${meta.bg} border ${meta.border} rounded-xl p-4 transition-all hover:shadow-lg`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">{meta.icon}</span>
                <h3 className={`font-bold text-sm ${meta.color}`}>{meta.label}</h3>
              </div>
              <div className="text-2xl font-mono text-white my-2">{fm(prices[drug])}</div>
              <div className="text-[10px] text-zinc-500 mb-3">per kg • {currentCity}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => buyDrug(drug)}
                  className="flex-1 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-semibold transition-colors"
                >
                  {t('dealer_buy', { qty: buyQty })}
                </button>
                <button
                  onClick={() => sellDrug(drug, sellQty)}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-xs font-semibold transition-colors"
                >
                  {t('dealer_sell', { qty: sellQty })}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-amber-400 hover:text-amber-300 transition-colors">← {t('common_back')}</Link>
    </div>
  );
}
