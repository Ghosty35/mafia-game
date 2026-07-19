'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import Panel from '../components/Panel';

type Listing = {
  id: string;
  seller_id: string;
  seller?: string;
  lab_id: string | null;
  drug_type: string;
  qty: number;
  price_per_kg: number;
  total: number;
  status: string;
  created_at: string;
  is_mine: boolean;
};

type FormState = {
  drug_type: string;
  qty: string;
  price_per_kg: string;
};

const DRUGS = ['Coke', 'Meth', 'Pills'] as const;
type Drug = typeof DRUGS[number];

const DRUG_META: Record<Drug, { icon: string; color: string; bg: string; label: string }> = {
  Coke:  { icon: '💎', color: 'text-zinc-200',   bg: 'bg-zinc-800/50',   label: 'Cocaine' },
  Meth:  { icon: '🧪', color: 'text-sky-300',    bg: 'bg-sky-950/30',    label: 'Meth' },
  Pills: { icon: '💊', color: 'text-fuchsia-300', bg: 'bg-fuchsia-950/30', label: 'Pills' },
};

const fmt = (n: number, locale = 'en') =>
  new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));

export default function DrugMarketplacePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language } = useLanguage();
  const router = useRouter();
  const supabase = createClient();

  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<Drug | 'all'>('all');
  const [tab, setTab] = useState<'browse' | 'sell'>('browse');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState<FormState>({
    drug_type: 'Coke',
    qty: '1',
    price_per_kg: '1000',
  });

  const drugStorage = (type: string) => Math.floor(player?.drug_storage?.[type] ?? 0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_drug_market_listings', {
      p_drug_type: filter === 'all' ? null : filter,
    });
    if (data) setListings(data as Listing[]);
  }, [filter, supabase]);

  useEffect(() => {
    if (player) {
      load();
    }
  }, [player?.id, load]);

  useEffect(() => {
    const poll = setInterval(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load();
    }, 15000);
    return () => clearInterval(poll);
  }, [load]);

  const handleList = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    const qty = parseInt(form.qty);
    const price = parseInt(form.price_per_kg);
    if (!qty || qty < 1) {
      setError(t('dm_not_enough_stock'));
      setBusy(false);
      return;
    }
    const { error: err } = await supabase.rpc('list_drugs_for_sale', {
      p_lab_id: null,
      p_drug_type: form.drug_type,
      p_qty: qty,
      p_price_per_kg: price,
    });
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('IN_JAIL')) setError(t('dl_err_in_jail'));
      else if (m.includes('DEAD')) setError(t('dl_err_dead'));
      else if (m.includes('NOT_ENOUGH_STOCK')) setError(t('dm_not_enough_stock'));
      else if (m.includes('INVALID_QTY') || m.includes('INVALID_PRICE')) setError(t('common_error'));
      else setError(m || t('dm_list_failed'));
    } else {
      setMessage(t('dm_listed', { qty, drug: DRUG_META[form.drug_type as Drug]?.label ?? form.drug_type, price: fmt(price, language) }));
      setForm((f) => ({ ...f, qty: '1' }));
      await load();
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
    }
  };

  const handleBuy = async (listing: Listing) => {
    setBusy(true);
    setMessage('');
    setError('');
    const { error: err } = await supabase.rpc('buy_drugs_from_listing', { p_listing_id: listing.id });
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('IN_JAIL')) setError(t('dl_err_in_jail'));
      else if (m.includes('DEAD')) setError(t('dl_err_dead'));
      else if (m.includes('NOT_ENOUGH_CASH')) setError(t('dm_not_enough_cash'));
      else if (m.includes('CAP_REACHED')) setError(t('dm_cap_reached'));
      else if (m.includes('CANNOT_BUY_OWN')) setError(t('dm_cannot_buy_own'));
      else if (m.includes('LISTING_NOT_FOUND')) setError(t('dm_listing_not_found'));
      else setError(m || t('dm_buy_failed'));
    } else {
      setMessage(t('dm_bought', { qty: listing.qty, drug: DRUG_META[listing.drug_type as Drug]?.label ?? listing.drug_type, total: fmt(listing.total, language) }));
      await load();
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
    }
  };

  const handleCancel = async (listing: Listing) => {
    setBusy(true);
    setMessage('');
    setError('');
    const { error: err } = await supabase.rpc('cancel_drug_listing', { p_listing_id: listing.id });
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('IN_JAIL')) setError(t('dl_err_in_jail'));
      else if (m.includes('DEAD')) setError(t('dl_err_dead'));
      else if (m.includes('LISTING_NOT_FOUND')) setError(t('dm_listing_not_found'));
      else setError(m || t('dm_cancel_failed'));
    } else {
      setMessage(t('dm_cancelled', { qty: listing.qty, drug: DRUG_META[listing.drug_type as Drug]?.label ?? listing.drug_type }));
      await load();
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
    }
  };

  if (!player) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const myListings = listings.filter((l) => l.is_mine);
  const activeListings = listings.filter((l) => !l.is_mine);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">💊 {t('dm_title')}</h1>
        <p className="text-xs text-zinc-400">{t('dm_desc')}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {message && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{message}</div>}

      {/* Filter + Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([['browse', '🔨', t('dm_browse')], ['sell', '🏷️', t('dm_list')]] as const).map(([k, icon, label]) => (
            <button
              key={k}
              onClick={() => { setTab(k as 'browse' | 'sell'); setError(''); setMessage(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                tab === k ? 'bg-red-900/50 border-red-700 text-red-300' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Drug | 'all')}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">{t('dm_browse')} (All)</option>
          {DRUGS.map((d) => (
            <option key={d} value={d}>{DRUG_META[d].icon} {DRUG_META[d].label}</option>
          ))}
        </select>
      </div>

      {tab === 'browse' ? (
        <Panel title={t('dm_browse')} icon="🔨" bodyClassName="p-0">
          {activeListings.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('dm_no_listings')}</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {activeListings.map((l) => {
                const meta = DRUG_META[l.drug_type as Drug] ?? DRUG_META['Coke'];
                return (
                  <div key={l.id} className="px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-zinc-800/30">
                    <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-lg shrink-0">
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm">
                        {meta.label} <span className="text-zinc-500">x{l.qty} kg</span>
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {t('dm_seller')}: <span className="text-zinc-300">{l.seller ?? 'Unknown'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('dm_price')} / kg</div>
                      <div className="font-mono text-emerald-400 text-sm">{fmt(l.price_per_kg, language)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('dm_total')}</div>
                      <div className="font-mono text-white text-sm">{fmt(l.total, language)}</div>
                    </div>
                    <button
                      onClick={() => handleBuy(l)}
                      disabled={busy}
                      className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-semibold disabled:opacity-40"
                    >
                      {t('common_buy')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title={t('dm_list')} icon="🏷️">
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dm_drug_type')}</label>
                <select
                  value={form.drug_type}
                  onChange={(e) => setForm((f) => ({ ...f, drug_type: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {DRUGS.map((d) => (
                    <option key={d} value={d}>{DRUG_META[d].icon} {DRUG_META[d].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dm_qty')} (have: {drugStorage(form.drug_type)} kg)</label>
                <input
                  type="number"
                  min={1}
                  max={drugStorage(form.drug_type)}
                  value={form.qty}
                  onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dm_price')} per kg</label>
                <input
                  type="number"
                  min={1}
                  value={form.price_per_kg}
                  onChange={(e) => setForm((f) => ({ ...f, price_per_kg: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                onClick={handleList}
                disabled={busy || parseInt(form.qty) < 1 || parseInt(form.qty) > drugStorage(form.drug_type)}
                className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {busy ? t('dl_buying') : `${t('dm_list')} (${fmt(parseInt(form.qty) || 0, language)} kg)`}
              </button>
              <p className="text-[11px] text-zinc-500">{t('dm_desc')}</p>
            </div>
          </Panel>

          <Panel title={t('dm_your_listings')} icon="📋">
            {myListings.length === 0 ? (
              <p className="text-sm text-zinc-500">{t('dm_no_listings')}</p>
            ) : (
              <div className="space-y-2">
                {myListings.map((l) => {
                  const meta = DRUG_META[l.drug_type as Drug] ?? DRUG_META['Coke'];
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{meta.icon} {meta.label} x{l.qty} kg</div>
                        <div className="text-[11px] text-zinc-500">{fmt(l.price_per_kg, language)} / kg • Total: {fmt(l.total, language)}</div>
                      </div>
                      <button
                        onClick={() => handleCancel(l)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-semibold disabled:opacity-40 shrink-0"
                      >
                        {t('common_cancel')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      <Link href="/drug-lab" className="inline-block text-sm text-amber-400 hover:text-amber-300 transition-colors">← {t('dl_back')}</Link>
    </div>
  );
}
