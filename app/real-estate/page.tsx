'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey, TranslationParams } from '@/lib/i18n/translations';

interface Property {
  id: string;
  // NOTE: name stays English — game logic and the DB parse it
  // (includes('mansion') etc). Display uses nameKey/riskKey.
  name: string;
  nameKey: TranslationKey;
  type: string;
  city: string;
  price: number;
  income: number;
  spots: number;
  riskKey?: TranslationKey;
  riskParams?: TranslationParams;
  image: string;
}

export default function RealEstatePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [billAmount, setBillAmount] = useState(0);
  const [autopay, setAutopay] = useState(false);

  if (!player) return <div className="p-6">{t('loading')}</div>;

  const currentCity = player.current_city || 'New York';

  // Properties are city-specific. You only see (and can buy) properties in the city you are currently in.
  // Travel to other cities to view and purchase their real estate.
  const allProperties: Property[] = [
    // New York
    { id: 'ts1', type: 'agency', name: 'Train Station', nameKey: 're_name_train_station', city: 'New York', price: 25000, income: 100, spots: 0, image: 'https://picsum.photos/id/1015/300/150', riskKey: 're_risk_low' },
    { id: 'house1', type: 'residential', name: 'House (Weed/Safehouse)', nameKey: 're_name_house', city: 'New York', price: 15000, income: 40, spots: 2, image: 'https://picsum.photos/id/29/300/150', riskKey: 're_risk_house_65' },
    // Chicago
    { id: 'mf1', type: 'agency', name: 'Metal Factory', nameKey: 're_name_metal_factory', city: 'Chicago', price: 45000, income: 240, spots: 0, image: 'https://picsum.photos/id/160/300/150', riskKey: 're_risk_medium' },
    { id: 'villa1', type: 'residential', name: 'Villa (Weed/Safehouse)', nameKey: 're_name_villa', city: 'Chicago', price: 75000, income: 120, spots: 4, image: 'https://picsum.photos/id/160/300/150', riskKey: 're_risk_villa_30' },
    // Los Angeles
    { id: 'da1', type: 'agency', name: 'Detective Agency', nameKey: 're_name_detective', city: 'Los Angeles', price: 30000, income: 160, spots: 0, image: 'https://picsum.photos/id/201/300/150', riskKey: 're_risk_low' },
    { id: 'house_la', type: 'residential', name: 'House (Weed/Safehouse)', nameKey: 're_name_house', city: 'Los Angeles', price: 16000, income: 42, spots: 2, image: 'https://picsum.photos/id/29/300/150', riskKey: 're_risk_raid', riskParams: { pct: 62 } },
    // Miami
    { id: 'h1', type: 'agency', name: 'Hospital', nameKey: 're_name_hospital', city: 'Miami', price: 35000, income: 180, spots: 0, image: 'https://picsum.photos/id/251/300/150', riskKey: 're_risk_medium' },
    { id: 'villa_mi', type: 'residential', name: 'Villa (Weed/Safehouse)', nameKey: 're_name_villa', city: 'Miami', price: 78000, income: 125, spots: 4, image: 'https://picsum.photos/id/160/300/150', riskKey: 're_risk_raid', riskParams: { pct: 28 } },
    // Las Vegas
    { id: 'gb1', type: 'agency', name: 'General Bank', nameKey: 're_name_bank', city: 'Las Vegas', price: 80000, income: 400, spots: 0, image: 'https://picsum.photos/id/180/300/150', riskKey: 're_risk_high' },
    { id: 'mansion1', type: 'residential', name: 'Mansion (Weed/Safehouse)', nameKey: 're_name_mansion', city: 'Las Vegas', price: 1500000, income: 300, spots: 8, image: 'https://picsum.photos/id/251/300/150', riskKey: 're_risk_none_ultimate' },
    // Extra residential options per city for variety
    { id: 'house_chi', type: 'residential', name: 'House (Weed/Safehouse)', nameKey: 're_name_house', city: 'Chicago', price: 15500, income: 41, spots: 2, image: 'https://picsum.photos/id/29/300/150', riskKey: 're_risk_raid', riskParams: { pct: 64 } },
    { id: 'mansion_la', type: 'residential', name: 'Mansion (Weed/Safehouse)', nameKey: 're_name_mansion', city: 'Los Angeles', price: 1550000, income: 295, spots: 8, image: 'https://picsum.photos/id/251/300/150', riskKey: 're_risk_none_ever' },
    { id: 'house_mi', type: 'residential', name: 'House (Weed/Safehouse)', nameKey: 're_name_house', city: 'Miami', price: 15200, income: 39, spots: 2, image: 'https://picsum.photos/id/29/300/150', riskKey: 're_risk_raid', riskParams: { pct: 63 } },
    { id: 'villa_lv', type: 'residential', name: 'Villa (Weed/Safehouse)', nameKey: 're_name_villa', city: 'Las Vegas', price: 82000, income: 130, spots: 4, image: 'https://picsum.photos/id/160/300/150', riskKey: 're_risk_raid', riskParams: { pct: 25 } },
  ];

  // IMPORTANT: Only show properties of the CURRENT city. Travel to see others.
  const cityProperties = allProperties.filter((p) => p.city === currentCity);
  const buyableProperties = cityProperties.filter((p) => p.type === 'residential');
  const agencyProperties = cityProperties.filter((p) => p.type === 'agency');

  const buyProperty = async (prop: Property) => {
    if (!player || player.cash < prop.price) {
      setMessage(t('common_not_enough_cash'));
      return;
    }

    const owned = player.owned_properties || [];
    const mansions = owned.filter((o) => o.name.toLowerCase().includes('mansion')).length;
    const villas = owned.filter((o) => o.name.toLowerCase().includes('villa')).length;
    const houses = owned.filter((o) => o.name.toLowerCase().includes('house')).length;

    const isMansion = prop.name.toLowerCase().includes('mansion');
    const isVilla = prop.name.toLowerCase().includes('villa');
    const isHouse = prop.name.toLowerCase().includes('house');

    if (isMansion && mansions >= 1) {
      setMessage(t('re_max_mansion'));
      return;
    }
    if (isVilla && villas >= 2) {
      setMessage(t('re_max_villas'));
      return;
    }
    if (
      isVilla &&
      villas > 0 &&
      owned.some((o) => o.name.toLowerCase().includes('villa') && o.city === prop.city)
    ) {
      setMessage(t('re_villa_diff_city'));
      return;
    }
    if (isHouse) {
      const housesInCity = owned.filter(
        (o) => o.name.toLowerCase().includes('house') && o.city === prop.city,
      ).length;
      if (housesInCity >= 1) {
        setMessage(t('re_house_in_city'));
        return;
      }
      if (houses >= 4) {
        setMessage(t('re_max_houses'));
        return;
      }
    }
    if (owned.length >= 4) {
      setMessage(t('re_total_limit'));
      return;
    }

    // Warning for multiple properties - generated message
    const houseCount = isHouse ? houses + 1 : houses;
    if (houseCount > 1) {
      const warnings = [t('re_warning_1'), t('re_warning_2'), t('re_warning_3')];
      setMessage(warnings[Math.floor(Math.random() * warnings.length)]);
    }

    setBusy(true);

    // Prompt for custom name
    const customName = prompt(t('re_prompt_name'), prop.name) || prop.name;

    // Tax on purchase (calibrated 10% for properties)
    const tax = Math.floor(prop.price * 0.1);
    const totalCost = prop.price + tax;

    if (player.cash < totalCost) {
      setMessage(t('re_no_cash_tax'));
      setBusy(false);
      return;
    }

    // Server-side purchase: deducts cash + tax atomically and appends the property
    const newProp = {
      id: prop.id,
      name: customName,
      type: prop.type,
      city: prop.city,
      purchase_date: new Date().toISOString(),
      bank_balance: 0,
      maintenance_due: Math.floor(prop.income * 0.12),
      autopay: false,
      shed_level: 1,
      earnings_week: 0,
      last_earned: new Date().toISOString(),
    };

    const supabase = createClient();
    const { error } = await supabase.rpc('purchase_property', { prop: newProp, price: prop.price });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('re_no_cash_tax'));
      else if (error.message.includes('PROPERTY_LIMIT_REACHED')) setMessage(t('re_total_limit'));
      else setMessage(error.message || t('re_purchase_failed'));
      setBusy(false);
      return;
    }

    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(
      t('re_bought', {
        name: customName,
        city: prop.city,
        price: `$${prop.price}`,
        tax: `$${tax}`,
      }),
    );
    setBusy(false);
  };

  // Advanced Billing
  const payBill = async (propId: string, amount: number, method: 'cash' | 'bank') => {
    if (!player) return;

    const owned = player.owned_properties || [];
    const prop = owned.find((p) => p.id === propId);
    if (!prop) return;

    const totalDebt = prop.maintenance_due || 850;
    const pay = Math.min(amount, totalDebt);

    if (
      !confirm(
        t('re_confirm_pay', { amount: `$${pay}`, method }) +
          (method === 'bank' ? t('re_bank_extra') : ''),
      )
    ) {
      return;
    }

    // Server-side payment: validates funds and updates debt atomically
    const supabase = createClient();
    const { error } = await supabase.rpc('pay_property_bill', {
      prop_id: propId,
      amount: pay,
      method,
    });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (error.message.includes('NOT_ENOUGH_IN_BANK')) setMessage(t('re_no_bank'));
      else setMessage(error.message || t('re_payment_failed'));
      return;
    }

    const newDebt = totalDebt - pay;
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(
      `${t('re_paid', { amount: `$${pay}`, method, debt: `$${newDebt}` })} ${
        newDebt > 0 ? t('re_pay_more') : t('re_all_clear')
      }`,
    );
  };

  const setAutopayForProp = async (propId: string, enable: boolean) => {
    if (!player) return;
    if (!confirm(enable ? t('re_confirm_autopay_on') : t('re_confirm_autopay_off'))) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc('set_property_autopay', { prop_id: propId, enable });
    if (error) {
      setMessage(error.message || t('re_autopay_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(enable ? t('re_autopay_on_msg') : t('re_autopay_off_msg'));
  };

  // Calculate maintenance suitable prices (avg ~12-15% of income, adjusted for risk)
  const getMaintenance = (prop: Property) => Math.floor(prop.income * 0.12);

  const getAvgProfit = (prop: Property) => prop.income - getMaintenance(prop);

  const owned = player.owned_properties || [];

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 {t('re_title')}</h1>
      <p className="text-sm text-zinc-400 mb-2">{t('re_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      {/* City notice - key rule per user spec */}
      <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-red-900/40 text-sm">
        <span className="font-semibold text-red-400">{t('re_current_city')}</span>{' '}
        <span className="font-bold">{currentCity}</span>
        <span className="mx-2 text-zinc-500">•</span>
        {t('re_city_only', { city: currentCity })}
        <Link href="/travel" className="ml-2 text-red-400 underline">
          {t('re_travel_now')}
        </Link>
      </div>

      <p className="text-xs text-zinc-500 mb-6">{t('re_dev_note')}</p>

      {/* Buyable Residential Only - filtered to current city */}
      <h2 className="text-xl font-semibold mb-3">{t('re_buyable_title', { city: currentCity })}</h2>
      {buyableProperties.length === 0 && (
        <p className="text-sm text-amber-400 mb-4">{t('re_none', { city: currentCity })}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {buyableProperties.map((prop, i) => {
          const maint = getMaintenance(prop);
          const profit = getAvgProfit(prop);
          return (
            <div key={i} className="card p-5">
              <img src={prop.image} alt={t(prop.nameKey)} className="w-full h-32 object-cover rounded mb-3" />
              <h3 className="font-bold text-lg">
                {t(prop.nameKey)} - {prop.city}
              </h3>
              <div className="text-xs mb-2">
                {t('re_spots_note', { spots: prop.spots })}{' '}
                {prop.riskKey
                  ? t('re_risk_label', { risk: t(prop.riskKey, prop.riskParams) })
                  : t('re_no_risk')}
              </div>

              <div className="my-2 text-sm">
                <div>
                  {t('re_purchase')} <span className="font-mono">${prop.price.toLocaleString()}</span>
                </div>
                <div>
                  {t('re_avg_income')}{' '}
                  <span className="font-mono text-emerald-400">+${prop.income}/hr</span>
                </div>
                <div>
                  {t('re_avg_maint')} <span className="font-mono text-red-400">-${maint}/hr</span>
                </div>
                <div>
                  {t('re_avg_profit')}{' '}
                  <span className="font-mono text-emerald-400">+${profit}/hr</span>
                </div>
                <div className="italic text-amber-400 text-xs mt-1">{t('re_flavor_residential')}</div>
              </div>

              <button
                onClick={() => buyProperty(prop)}
                disabled={busy}
                className="w-full mt-2 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold"
              >
                {t('re_buy_button', { name: t(prop.nameKey) })}
              </button>
            </div>
          );
        })}
      </div>

      {/* Agency Properties - Info only, no buy (current city only) */}
      <h2 className="text-xl font-semibold mb-3">{t('re_agency_title', { city: currentCity })}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {agencyProperties.map((prop, i) => {
          const maint = getMaintenance(prop);
          const profit = getAvgProfit(prop);
          return (
            <div key={i} className="card p-5 border border-amber-900">
              <img src={prop.image} alt={t(prop.nameKey)} className="w-full h-32 object-cover rounded mb-3" />
              <h3 className="font-bold text-lg">
                {t(prop.nameKey)} - {prop.city}
              </h3>
              <div className="text-xs mb-2">
                {t('re_agency_income_note')}{' '}
                {prop.riskKey ? t('re_risk_label', { risk: t(prop.riskKey, prop.riskParams) }) : ''}
              </div>
              <div className="my-2 text-sm">
                <div>
                  {t('re_avg_income')}{' '}
                  <span className="font-mono text-emerald-400">+${prop.income}/hr</span>
                </div>
                <div>
                  {t('re_avg_maint')} <span className="font-mono text-red-400">-${maint}/hr</span>
                </div>
                <div>
                  {t('re_avg_profit')}{' '}
                  <span className="font-mono text-emerald-400">+${profit}/hr</span>
                </div>
                <div className="italic text-amber-400 text-xs mt-1">{t('re_flavor_agency')}</div>
              </div>
              <div className="text-xs text-zinc-500">{t('re_agency_bid_note')}</div>
            </div>
          );
        })}
      </div>

      {/* Advanced Professional Billing Menu */}
      <h2 className="text-xl font-semibold mb-3">{t('re_billing_title')}</h2>
      <div className="card p-6 mb-6">
        <div className="mb-4 flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
            {t('re_autopay_label')}
          </label>
        </div>

        {owned.length === 0 && <p className="text-zinc-500">{t('re_no_properties')}</p>}

        {owned.map((prop, idx) => {
          const debt = prop.maintenance_due || 850;
          const purchaseDate = prop.purchase_date
            ? new Date(prop.purchase_date).toLocaleDateString()
            : 'N/A';
          const ownedDays = prop.purchase_date
            ? Math.floor((Date.now() - new Date(prop.purchase_date).getTime()) / (1000 * 3600 * 24))
            : 0;
          const maintCost = Math.floor((prop.income || 50) * 0.12); // suitable ~12%
          const avgProfit = (prop.income || 50) - maintCost;

          return (
            <div key={idx} className="mb-6 border border-zinc-700 rounded p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-2">
                <div>
                  <div className="font-bold text-lg">{t('re_property', { name: prop.name })}</div>
                  <div className="text-xs text-zinc-400">
                    {t('re_purchased_on', { date: purchaseDate, days: ownedDays })}
                  </div>
                  <div className="text-xs">
                    {t('re_city_type', {
                      city: prop.city,
                      type: prop.type,
                      spots: prop.spots || 'N/A',
                    })}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>
                    {t('re_current_debt')} <span className="font-mono text-red-400">${debt}</span>
                  </div>
                  <div>
                    {t('re_avg_maint_short')} <span className="font-mono">-${maintCost}/hr</span>
                  </div>
                  <div>
                    {t('re_avg_profit')}{' '}
                    <span className="font-mono text-emerald-400">+${avgProfit}/hr</span>
                  </div>
                </div>
              </div>

              <div className="text-xs mb-3">
                {t('re_prop_bank', { amount: `$${prop.bank_balance || 0}` })}
              </div>

              <div className="mb-3">
                <label className="block text-sm mb-1">{t('re_pay_amount')}</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="number"
                    value={billAmount}
                    onChange={(e) => setBillAmount(parseInt(e.target.value) || 0)}
                    className="bg-zinc-900 border border-zinc-700 px-3 py-1 rounded w-32"
                    placeholder={t('common_amount')}
                  />
                  <button
                    onClick={() => payBill(prop.id, billAmount, 'cash')}
                    className="px-4 py-1 bg-emerald-700 rounded text-sm"
                  >
                    {t('re_pay_cash')}
                  </button>
                  <button
                    onClick={() => payBill(prop.id, billAmount, 'bank')}
                    className="px-4 py-1 bg-emerald-700 rounded text-sm"
                  >
                    {t('re_pay_bank')}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => payBill(prop.id, debt, 'cash')}
                  className="px-4 py-1 bg-emerald-700 rounded text-sm"
                >
                  {t('re_full_pay')}
                </button>
                <button
                  onClick={() => payBill(prop.id, Math.floor(debt / 2), 'bank')}
                  className="px-4 py-1 bg-emerald-700 rounded text-sm"
                >
                  {t('re_payment_plan')}
                </button>
                <button
                  onClick={() => setAutopayForProp(prop.id, !prop.autopay)}
                  className="px-4 py-1 bg-blue-700 rounded text-sm"
                >
                  {prop.autopay ? t('re_autopay_disable') : t('re_autopay_enable')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
