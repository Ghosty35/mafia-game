'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';

export const dynamic = 'force-dynamic';

// Post Office (bug-inspectie): the Real Estate Billing Center, moved out of
// the property shop into its own Economy submenu. Pay property bills and taxes
// here; buying property stays on /real-estate.
export default function PostOfficePage() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm, language } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const supabase = createClient();
  const owned = player?.owned_properties ?? [];
  const dateLocale = language === 'nl' ? 'nl-NL' : 'en-US';

  const totalDebt = owned.reduce((sum, p) => sum + (p.maintenance_due || 0), 0);

  const payBill = async (propId: string, amount: number, method: 'cash' | 'bank') => {
    const prop = owned.find((p) => p.id === propId);
    if (!prop || amount <= 0) return;

    const debt = prop.maintenance_due || 0;
    const pay = Math.min(amount, debt);
    if (pay <= 0) return;

    if (!confirm(t('po_confirm', { amount: fm(pay), method: t(method === 'bank' ? 'po_via_bank' : 'po_via_cash') }))) return;

    setBusy(true);
    const { error } = await supabase.rpc('pay_property_bill', { prop_id: propId, amount: pay, method });
    setBusy(false);

    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) showToast(t('common_not_enough_cash'));
      else if (error.message.includes('NOT_ENOUGH_IN_BANK')) showToast(t('re_no_bank'));
      else showToast(t('re_payment_failed'));
      return;
    }

    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(t('po_paid', { amount: fm(pay), debt: fm(debt - pay) }));
  };

  if (!player) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">📮 {t('po_title')}</h1>
        <p className="text-xs text-zinc-400">{t('po_subtitle')}</p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('po_total_due')}</div>
          <div className={`font-mono font-bold text-xl tabular-nums ${totalDebt > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {fm(totalDebt)}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('po_properties')}</div>
          <div className="font-mono font-bold text-xl tabular-nums text-white">{owned.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('po_taxes_paid')}</div>
          <div className="font-mono font-bold text-xl tabular-nums text-amber-400">{fm(player.gov_tax_bank ?? 0)}</div>
        </div>
      </div>

      {/* Bills */}
      {owned.length === 0 ? (
        <Panel title={t('po_bills_title')} icon="🧾">
          <p className="text-sm text-zinc-500">
            {t('po_no_properties')}{' '}
            <Link href="/real-estate" className="text-red-400 hover:underline">{t('menu_real_estate')}</Link>
          </p>
        </Panel>
      ) : (
        owned.map((prop) => {
          const debt = prop.maintenance_due || 0;
          const amt = amounts[prop.id] ?? debt;
          return (
            <Panel
              key={prop.id}
              title={prop.name}
              icon="🏠"
              actions={
                <span className={`text-[10px] font-mono ${debt > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {debt > 0 ? t('po_owes', { amount: fm(debt) }) : t('po_clear')}
                </span>
              }
            >
              <div className="text-[11px] text-zinc-500 mb-3">
                🏙️ {prop.city} • {prop.type}
                {prop.purchase_date && <> • {t('po_since', { date: new Date(prop.purchase_date).toLocaleDateString(dateLocale) })}</>}
              </div>

              {debt > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <input
                      type="number"
                      value={amt}
                      min={1}
                      max={debt}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [prop.id]: Math.max(1, Math.min(debt, parseInt(e.target.value) || 1)) }))
                      }
                      className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 w-32 text-sm font-mono"
                    />
                    <button
                      onClick={() => payBill(prop.id, amt, 'cash')}
                      disabled={busy}
                      className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-xs font-semibold disabled:opacity-50"
                    >
                      💵 {t('po_pay_cash')}
                    </button>
                    <button
                      onClick={() => payBill(prop.id, amt, 'bank')}
                      disabled={busy}
                      className="px-4 py-1.5 bg-blue-800 hover:bg-blue-700 rounded-lg text-xs font-semibold disabled:opacity-50"
                    >
                      🏦 {t('po_pay_bank')}
                    </button>
                    <button
                      onClick={() => payBill(prop.id, debt, 'cash')}
                      disabled={busy}
                      className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs ml-auto disabled:opacity-50"
                    >
                      {t('po_pay_all', { amount: fm(debt) })}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500">{t('po_bank_fee')}</p>
                </>
              ) : (
                <p className="text-sm text-emerald-400">✅ {t('po_all_clear')}</p>
              )}
            </Panel>
          );
        })
      )}

      <div className="text-[11px] text-zinc-500">
        {t('po_footer')}{' '}
        <Link href="/reputations/tax-bank" className="text-red-400 hover:underline">🏛️ {t('menu_tax_bank')}</Link>
      </div>
    </div>
  );
}
