'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';
import { useMyFamily } from '../../components/useMyFamily';

export const dynamic = 'force-dynamic';

// Family Bank (bug-inspectie): view-only for regular members, maintainable
// by higher-ups. Shows the treasury, the hourly-pay claim for every member,
// and leader-only power purchasing.
export default function FamilyBankPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const router = useRouter();
  const { data, loading, reload, inFamily, canManageTreasury } = useMyFamily();

  const [spendAmount, setSpendAmount] = useState(50000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const fam = data?.family;

  const claimHourly = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    const { data: res, error: err } = await supabase.rpc('claim_family_hourly');
    setBusy(false);
    if (err) {
      setError(t('fb_err_claim'));
      return;
    }
    if (res?.success) {
      await reload();
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
      setMsg(t('fb_claimed', {
        hours: res.hours,
        total: fm(res.total_pay),
        bank: fm(res.bank_deposit),
        cash: fm(res.cash_deposit),
      }));
    } else {
      setMsg(t('fb_nothing_due', { hours: res?.hours ?? 0 }));
    }
  };

  const buyPower = async () => {
    if (!spendAmount || spendAmount < 25000) return;
    if (!confirm(t('fb_confirm_power', { amount: fm(spendAmount) }))) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    const { data: res, error: err } = await supabase.rpc('buy_family_power', { spend_amount: spendAmount });
    setBusy(false);
    if (err) {
      setError(err.message.includes('NOT_AUTHORIZED') ? t('fb_err_power_authorized') : t('fb_err_power'));
      return;
    }
    await reload();
    router.refresh();
    setMsg(t('fb_power_bought', { power: res?.power_gained ?? '?', amount: fm(spendAmount) }));
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  }

  if (!inFamily || !fam) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('fb_title')} icon="💰">
          <p className="text-sm text-zinc-300 mb-4">{t('fam_none_text')}</p>
          <Link href="/families/join" className="inline-block px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            {t('fam_none_join')}
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">💰 {t('fb_title')}</h1>
        <p className="text-xs text-zinc-400">{t('fb_subtitle', { family: fam.name })}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {msg && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{msg}</div>}

      {/* Treasury overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fb_balance')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-emerald-400">{fm(fam.bank ?? 0)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fam_stat_power')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-orange-400">{(fam.power ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fam_stat_respect')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-amber-400">{fam.respect.toLocaleString()}</div>
        </div>
      </div>

      {/* Hourly pay — every member */}
      <Panel title={t('fb_hourly_title')} icon="⏰">
        <p className="text-xs text-zinc-400 mb-3">{t('fb_hourly_text')}</p>
        <button
          onClick={claimHourly}
          disabled={busy}
          className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {busy ? t('fb_claiming') : t('fb_claim')}
        </button>
      </Panel>

      {/* Leader-only treasury management */}
      {canManageTreasury ? (
        <Panel title={t('fb_power_title')} icon="⚔️">
          <p className="text-xs text-zinc-400 mb-3">{t('fb_power_text')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={spendAmount}
              min={25000}
              onChange={(e) => setSpendAmount(Math.max(25000, parseInt(e.target.value) || 25000))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 w-40 text-sm font-mono"
            />
            <button
              onClick={buyPower}
              disabled={busy}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? t('fb_buying') : t('fb_buy_power')}
            </button>
            <span className="text-[11px] text-zinc-500">{t('fb_power_rate', { min: fm(25000) })}</span>
          </div>
        </Panel>
      ) : (
        <div className="text-[11px] text-zinc-500 px-1">{t('fb_view_only')}</div>
      )}

      {/* How the treasury works */}
      <Panel title={t('fb_how_title')} icon="ℹ️">
        <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
          <li>{t('fb_how_1')}</li>
          <li>{t('fb_how_2')}</li>
          <li>{t('fb_how_3')}</li>
        </ul>
        <div className="mt-3">
          <Link href="/families/donations" className="text-xs text-red-400 hover:underline">🎁 {t('fb_go_donate')}</Link>
        </div>
      </Panel>
    </div>
  );
}
