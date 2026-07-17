'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey, TranslationParams } from '@/lib/i18n/translations';

// Display-only metadata for the catalog. Economic values come from the server.
const PROPERTY_META: Record<string, { nameKey: TranslationKey; riskKey?: TranslationKey; riskParams?: TranslationParams; image: string }> = {
  ts1:        { nameKey: 're_name_train_station', riskKey: 're_risk_low', image: 'https://picsum.photos/id/1015/300/150' },
  house1:     { nameKey: 're_name_house', riskKey: 're_risk_house_65', image: 'https://picsum.photos/id/29/300/150' },
  mf1:        { nameKey: 're_name_metal_factory', riskKey: 're_risk_medium', image: 'https://picsum.photos/id/160/300/150' },
  villa1:     { nameKey: 're_name_villa', riskKey: 're_risk_villa_30', image: 'https://picsum.photos/id/160/300/150' },
  da1:        { nameKey: 're_name_detective', riskKey: 're_risk_low', image: 'https://picsum.photos/id/201/300/150' },
  house_la:   { nameKey: 're_name_house', riskKey: 're_risk_raid', riskParams: { pct: 62 }, image: 'https://picsum.photos/id/29/300/150' },
  h1:         { nameKey: 're_name_hospital', riskKey: 're_risk_medium', image: 'https://picsum.photos/id/251/300/150' },
  villa_mi:   { nameKey: 're_name_villa', riskKey: 're_risk_raid', riskParams: { pct: 28 }, image: 'https://picsum.photos/id/160/300/150' },
  gb1:        { nameKey: 're_name_bank', riskKey: 're_risk_high', image: 'https://picsum.photos/id/180/300/150' },
  mansion1:   { nameKey: 're_name_mansion', riskKey: 're_risk_none_ultimate', image: 'https://picsum.photos/id/251/300/150' },
  house_chi:  { nameKey: 're_name_house', riskKey: 're_risk_raid', riskParams: { pct: 64 }, image: 'https://picsum.photos/id/29/300/150' },
  mansion_la: { nameKey: 're_name_mansion', riskKey: 're_risk_none_ever', image: 'https://picsum.photos/id/251/300/150' },
  house_mi:   { nameKey: 're_name_house', riskKey: 're_risk_raid', riskParams: { pct: 63 }, image: 'https://picsum.photos/id/29/300/150' },
  villa_lv:   { nameKey: 're_name_villa', riskKey: 're_risk_raid', riskParams: { pct: 25 }, image: 'https://picsum.photos/id/160/300/150' },
};

type Property = {
  id: string;
  name: string;
  ptype: string;
  type: string;
  city: string;
  price: number;
  income: number;
  spots: number;
  nameKey: TranslationKey;
  riskKey?: TranslationKey;
  riskParams?: TranslationParams;
  image: string;
};

export default function RealEstatePage() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [billAmount, setBillAmount] = useState(0);
  const [autopay, setAutopay] = useState(false);
  const [catalog, setCatalog] = useState<Property[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  useEffect(() => {
    const loadCatalog = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_property_catalog');
      if (Array.isArray(data)) {
        setCatalog(
          data.map((row: any) => {
            const meta = PROPERTY_META[row.id] || { nameKey: 're_name_house' as TranslationKey, image: '' };
            return { ...row, ...meta };
          }),
        );
      }
      setLoadingCatalog(false);
    };
    loadCatalog();
  }, []);

  if (!player) return <div className="p-6">{t('loading')}</div>;

  const currentCity = player.current_city || 'New York';

  // IMPORTANT: Only show properties of the CURRENT city. Travel to see others.
  const cityProperties = catalog.filter((p) => p.city === currentCity);
  const buyableProperties = cityProperties.filter((p) => p.type === 'residential');
  const agencyProperties = cityProperties.filter((p) => p.type === 'agency');

  const buyProperty = async (prop: Property) => {
    if (!player) return;

    // Quick client-side cash check for instant feedback; the server is the
    // source of truth (price/tax/limits enforced in purchase_property).
    const tax = Math.floor(prop.price * 0.1);
    if (player.cash < prop.price + tax) {
      showToast(t('re_no_cash_tax'));
      return;
    }

    setBusy(true);

    // Custom name is display-only; the server derives price/type/income from
    // the property_catalog by id — the client can no longer forge them.
    const customName = prompt(t('re_prompt_name'), prop.name) || prop.name;

    const supabase = createClient();
    const { data, error } = await supabase.rpc('purchase_property', {
      p_catalog_id: prop.id,
      p_custom_name: customName,
    });
    if (error) {
      const m = error.message || '';
      if (m.includes('NOT_ENOUGH_CASH')) showToast(t('re_no_cash_tax'));
      else if (m.includes('PROPERTY_LIMIT_REACHED')) showToast(t('re_total_limit'));
      else if (m.includes('ALREADY_OWNED')) showToast(t('re_house_in_city'));
      else if (m.includes('MAX_MANSION')) showToast(t('re_max_mansion'));
      else if (m.includes('MAX_VILLAS')) showToast(t('re_max_villas'));
      else if (m.includes('MAX_HOUSES')) showToast(t('re_max_houses'));
      else if (m.includes('WRONG_CITY')) showToast(t('re_city_only', { city: prop.city }));
      else showToast(m || t('re_purchase_failed'));
      setBusy(false);
      return;
    }

    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(
      t('re_bought', {
        name: customName,
        city: prop.city,
        price: fm(prop.price),
        tax: fm(data?.tax ?? tax),
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
        t('re_confirm_pay', { amount: fm(pay), method }) +
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
      if (error.message.includes('NOT_ENOUGH_CASH')) showToast(t('common_not_enough_cash'));
      else if (error.message.includes('NOT_ENOUGH_IN_BANK')) showToast(t('re_no_bank'));
      else showToast(error.message || t('re_payment_failed'));
      return;
    }

    const newDebt = totalDebt - pay;
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(
      `${t('re_paid', { amount: fm(pay), method, debt: fm(newDebt) })} ${
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
      showToast(error.message || t('re_autopay_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(enable ? t('re_autopay_on_msg') : t('re_autopay_off_msg'));
  };

  // Calculate maintenance suitable prices (avg ~12-15% of income, adjusted for risk)
  const getMaintenance = (prop: Property) => Math.floor(prop.income * 0.12);

  const getAvgProfit = (prop: Property) => prop.income - getMaintenance(prop);

  const owned = player.owned_properties || [];

  // Mirror the server-side per-type caps (055_property_catalog_and_hardened_purchase.sql)
  // so the Buy buttons disable at max instead of allowing wasted clicks that the
  // server would reject. The server remains the source of truth.
  const ownedByPtype: Record<string, number> = {};
  for (const e of owned as any[]) {
    const ptype = (e?.ptype || e?.name || '').toLowerCase();
    if (ptype) ownedByPtype[ptype] = (ownedByPtype[ptype] || 0) + 1;
  }
  const isAtTotalCap = owned.length >= 4;
  const isPtypeMaxed = (ptype: string) => {
    if (ptype === 'mansion') return (ownedByPtype['mansion'] || 0) >= 1;
    if (ptype === 'villa') return (ownedByPtype['villa'] || 0) >= 2;
    if (ptype === 'house') return (ownedByPtype['house'] || 0) >= 4;
    return false;
  };
  const isDuplicateOwned = (prop: Property) =>
    owned.some((e: any) => e?.catalog_id === prop.id || e?.id === prop.id);

  const propertyBlockedReason = (prop: Property): string | null => {
    if (isDuplicateOwned(prop)) return t('re_house_in_city');
    if (isAtTotalCap) return t('re_total_limit');
    if (isPtypeMaxed(prop.ptype)) {
      if (prop.ptype === 'mansion') return t('re_max_mansion');
      if (prop.ptype === 'villa') return t('re_max_villas');
      if (prop.ptype === 'house') return t('re_max_houses');
    }
    return null;
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 {t('re_title')}</h1>
      <p className="text-sm text-zinc-400 mb-2">{t('re_desc')}</p>

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

      {loadingCatalog && (
        <div className="text-sm text-zinc-500 mb-4">{t('loading')}</div>
      )}

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
                  {t('re_purchase')} <span className="font-mono">{fm(prop.price)}</span>
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

              {(() => {
                const blocked = propertyBlockedReason(prop);
                const cantAfford = player.cash < prop.price + Math.floor(prop.price * 0.1);
                return (
                  <button
                    onClick={() => buyProperty(prop)}
                    disabled={busy || !!blocked || cantAfford}
                    className="w-full mt-2 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {blocked
                      ? blocked
                      : cantAfford
                        ? t('re_no_cash_tax')
                        : t('re_buy_button', { name: t(prop.nameKey) })}
                  </button>
                );
              })()}
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

      {/* Billing moved to its own Economy submenu: the Post Office. */}
      <div className="card p-5 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">📮 {t('po_title')}</div>
          <div className="text-xs text-zinc-400">{t('re_billing_moved')}</div>
        </div>
        <Link href="/post-office" className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold shrink-0">
          {t('re_billing_go')}
        </Link>
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
