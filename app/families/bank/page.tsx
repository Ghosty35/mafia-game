'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';
import { useMyFamily } from '../../components/useMyFamily';
import { useEconomy } from '@/lib/economy';

export const dynamic = 'force-dynamic';

type FamilyTxn = { icon: string; desc: string; amount: number; player: string; at: string };

export default function FamilyBankPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const router = useRouter();
  const { data, loading, reload, inFamily, canManageTreasury } = useMyFamily();
  const economy = useEconomy();

  const [spendAmount, setSpendAmount] = useState(50000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<FamilyTxn[]>([]);

  const supabase = createClient();
  const fam = data?.family;
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const minPowerSpend = economy?.family?.power_min_spend ?? 25000;

  const topDonors = useMemo(
    () => members.filter((m) => (m.donated ?? 0) > 0).sort((a, b) => (b.donated ?? 0) - (a.donated ?? 0)).slice(0, 5),
    [members],
  );

  const totalDonated = useMemo(
    () => members.reduce((s, m) => s + (m.donated ?? 0), 0),
    [members],
  );

  const loadTransactions = useCallback(async () => {
    const { data: txns } = await supabase.rpc('get_family_bank_transactions');
    if (txns) setTransactions(txns as FamilyTxn[]);
  }, [supabase]);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadTransactions();
    }
    const poll = setInterval(loadTransactions, 15000);
    return () => clearInterval(poll);
  }, [inFamily, loadTransactions]);

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
      await loadTransactions();
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
    if (!spendAmount || spendAmount < minPowerSpend) return;
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
    await loadTransactions();
    if (refreshPlayer) await refreshPlayer();
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

  const powerPct = Math.min(100, ((fam.power ?? 0) / 10000) * 100);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">💰 {t('fb_title')}</h1>
        <p className="text-xs text-zinc-400">{t('fb_subtitle', { family: fam.name })}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {msg && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{msg}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fb_total_donated')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-white">{fm(totalDonated)}</div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">{t('fb_power_capacity')}</span>
          <span className="font-mono text-xs text-orange-400">
            {Math.min(10000, fam.power ?? 0).toLocaleString()} / 10,000
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-600 to-amber-400 transition-all"
            style={{ width: `${powerPct}%` }}
          />
        </div>
        <p className="text-[10px] text-zinc-500 mt-1.5">{t('fb_power_capacity_hint')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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

        {canManageTreasury ? (
          <Panel title={t('fb_power_title')} icon="⚔️" variant="premium">
            <p className="text-xs text-zinc-400 mb-3">{t('fb_power_text')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                value={spendAmount}
                min={minPowerSpend}
                onChange={(e) => setSpendAmount(Math.max(minPowerSpend, parseInt(e.target.value) || minPowerSpend))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 w-40 text-sm font-mono"
              />
              <button
                onClick={buyPower}
                disabled={busy}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {busy ? t('fb_buying') : t('fb_buy_power')}
              </button>
            </div>
            <span className="text-[11px] text-zinc-500 mt-2 block">{t('fb_power_rate', { min: fm(minPowerSpend) })}</span>
          </Panel>
        ) : (
          <Panel title={t('fb_power_title')} icon="⚔️">
            <p className="text-xs text-zinc-400 mb-2">{t('fb_power_text')}</p>
            <p className="text-[11px] text-zinc-500">{t('fb_view_only')}</p>
          </Panel>
        )}
      </div>

      {topDonors.length > 0 && (
        <Panel title={t('fb_top_donors_title')} icon="🏅" bodyClassName="p-0">
          <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-7">{t('fam_col_member')}</div>
            <div className="col-span-4 text-right">{t('fam_col_donated')}</div>
          </div>
          {topDonors.map((m, i) => (
            <div key={m.player_id ?? i} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
              <div className="col-span-1 text-center font-mono text-red-500 text-xs font-semibold">#{i + 1}</div>
              <div className="col-span-7 truncate">
                <Link href={`/profile?user=${encodeURIComponent(m.username ?? '')}`} className="font-medium hover:text-red-400">
                  {m.username ?? '?'}
                </Link>
              </div>
              <div className="col-span-4 text-right font-mono text-emerald-400 tabular-nums text-xs">{fm(m.donated ?? 0)}</div>
            </div>
          ))}
        </Panel>
      )}

      {transactions.length > 0 && (
        <Panel title={t('fb_txn_title')} icon="📜" bodyClassName="p-0">
          <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            <div className="col-span-1"></div>
            <div className="col-span-5">{t('fb_txn_desc')}</div>
            <div className="col-span-3">{t('fb_txn_player')}</div>
            <div className="col-span-3 text-right">{t('fb_txn_amount')}</div>
          </div>
          {transactions.map((txn, i) => (
            <div key={i} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm">
              <div className="col-span-1 text-center text-base">{txn.icon}</div>
              <div className="col-span-5 text-zinc-300">{txn.desc}</div>
              <div className="col-span-3 text-zinc-400 text-xs truncate">{txn.player}</div>
              <div className="col-span-3 text-right font-mono text-emerald-400 tabular-nums text-xs">{fm(txn.amount)}</div>
            </div>
          ))}
        </Panel>
      )}

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
