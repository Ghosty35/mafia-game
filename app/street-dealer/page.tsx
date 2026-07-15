'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { CITIES, City } from '@/lib/cities';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const DRUGS = ['Coke', 'Weed', 'Meth', 'Pills'] as const;

type DrugPrices = Record<typeof DRUGS[number], number>;

const DRUG_CAPS: Record<typeof DRUGS[number], number> = {
  Coke: 200,   // limited carry
  Meth: 100,
  Pills: 300,
  Weed: 1000   // higher because growable in shed
};

export default function StreetDealerPage() {
  const { player, refreshPlayer, canPerformAction, recordAction, showToast } = usePlayer();
  const { t } = useLanguage();
  const [prices, setPrices] = useState<DrugPrices>({ Coke: 120, Weed: 80, Meth: 200, Pills: 50 });
  const [city, setCity] = useState<City>('New York');
  const [drugStorage, setDrugStorage] = useState<Record<string, number>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({}); // for timers like murder, grow
  const [buyQty, setBuyQty] = useState(1);
  const [sellQty, setSellQty] = useState(1);

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
      showToast(
        msg.includes('NOT_ENOUGH_CASH') ? t('dealer_no_cash_tax')
          : msg.includes('CAP_REACHED') ? t('dealer_cap_reached', { drug, cap: DRUG_CAPS[drug] })
          : (msg || t('dealer_purchase_failed')),
        'error',
      );
      return;
    }
    const res = data as { total: number; storage: Record<string, number> };
    if (res?.storage) setDrugStorage(res.storage);
    if (refreshPlayer) await refreshPlayer();
    showToast(t('dealer_bought', { amount, drug, total: `$${res?.total ?? ''}` }), 'success');
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
    if (refreshPlayer) await refreshPlayer();
    showToast(t('dealer_sold', { qty, drug, revenue: `$${res?.revenue ?? ''}` }), 'success');
  };

  if (!player) return <div>{t('loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <img src="https://picsum.photos/id/201/800/120" alt="Street Dealer" className="w-full h-24 object-cover rounded mb-4" />
      <h1 className="text-3xl font-bold mb-2">💊 {t('dealer_title', { city: currentCity })}</h1>
      <p className="text-sm text-zinc-400 mb-4">{t('dealer_desc')}</p>

      {/* Live Drug Storage Tracker */}
      <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">
        <div className="text-sm font-semibold mb-1">{t('dealer_storage_title')}</div>
        <div className="flex flex-wrap gap-4 text-xs">
          {DRUGS.map(d => (
            <span key={d}>{d}: <span className="font-mono text-emerald-400">{drugStorage[d] || 0} kg</span> / {DRUG_CAPS[d]}</span>
          ))}
        </div>
      </div>

      {/* Quantity controls — bulk buy/sell instead of spam-clicking */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400 w-16">Buy qty</span>
          <input
            type="number"
            min={1}
            value={buyQty}
            onChange={(e) => setBuyQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 font-mono"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400 w-16">Sell qty</span>
          <input
            type="number"
            min={1}
            value={sellQty}
            onChange={(e) => setSellQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 font-mono"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {DRUGS.map(drug => (
          <div key={drug} className="card p-4">
            {drug === 'Coke' && <img src="https://picsum.photos/id/201/300/80" alt="Coke" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Weed' && <img src="https://picsum.photos/id/160/300/80" alt="Weed" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Meth' && <img src="https://picsum.photos/id/251/300/80" alt="Meth" className="w-full h-16 object-cover rounded mb-2" />}
            {drug === 'Pills' && <img src="https://picsum.photos/id/180/300/80" alt="Pills" className="w-full h-16 object-cover rounded mb-2" />}
            <h3 className="font-bold">{drug}</h3>
            <div className="text-2xl font-mono text-emerald-400 my-2">${prices[drug]}</div>
            <div className="flex gap-2">
              <button onClick={() => buyDrug(drug)} className="flex-1 py-1 bg-red-700 rounded text-xs">{t('dealer_buy', { qty: buyQty })}</button>
              <button onClick={() => sellDrug(drug, sellQty)} className="flex-1 py-1 bg-emerald-700 rounded text-xs">{t('dealer_sell', { qty: sellQty })}</button>
            </div>
          </div>
        ))}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
