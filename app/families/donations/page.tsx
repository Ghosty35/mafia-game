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

const QUICK_AMOUNTS = [1000, 10000, 100000, 1000000];

// Family Donations (bug-inspectie): standalone donation page with a live
// personal running total that ticks up on every donation.
export default function FamilyDonationsPage() {
  const { t, fm } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const router = useRouter();
  const { data, loading, reload, inFamily } = useMyFamily();

  const [amount, setAmount] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // my_donated needs migration 074; until then show a local session total.
  const [localTotal, setLocalTotal] = useState(0);

  const supabase = createClient();
  const fam = data?.family;
  const myTotal = (data?.my_donated ?? 0) + (data?.my_donated == null ? localTotal : 0);

  const donate = async () => {
    if (!amount || amount <= 0) return;
    if (!confirm(t('fd_confirm', { amount: fm(amount), family: fam?.name ?? '' }))) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    const { data: res, error: err } = await supabase.rpc('donate_to_family', { amount });
    setBusy(false);
    if (err) {
      setError(err.message.includes('NOT_ENOUGH_CASH') ? t('common_not_enough_cash') : t('fd_err'));
      return;
    }
    setLocalTotal((v) => v + amount);
    await reload();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMsg(t('fd_done', {
      amount: fm(res?.donated ?? amount),
      respect: (res?.respect_gained ?? 0).toLocaleString(),
    }));
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  }

  if (!inFamily || !fam) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('fd_title')} icon="🎁">
          <p className="text-sm text-zinc-300 mb-4">{t('fam_none_text')}</p>
          <Link href="/families/join" className="inline-block px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            {t('fam_none_join')}
          </Link>
        </Panel>
      </div>
    );
  }

  const donors = [...(data?.members ?? [])]
    .filter((m) => (m.donated ?? 0) > 0)
    .sort((a, b) => (b.donated ?? 0) - (a.donated ?? 0));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🎁 {t('fd_title')}</h1>
        <p className="text-xs text-zinc-400">{t('fd_subtitle', { family: fam.name })}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {msg && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{msg}</div>}

      {/* My running total + family bank */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-emerald-900/60 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fd_my_total')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-emerald-400">{fm(myTotal)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fb_balance')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-white">{fm(fam.bank ?? 0)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('fd_pocket')}</div>
          <div className="font-mono font-bold tabular-nums text-2xl text-zinc-300">{fm(player?.cash ?? 0)}</div>
        </div>
      </div>

      {/* Donate */}
      <Panel title={t('fd_donate_title')} icon="💸">
        <p className="text-xs text-zinc-400 mb-3">{t('fd_donate_text')}</p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(q)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono border ${amount === q ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300' : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
            >
              {fm(q)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={amount}
            min={1}
            onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 w-40 text-sm font-mono"
          />
          <button
            onClick={donate}
            disabled={busy}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? t('fd_donating') : t('fd_donate')}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">{t('fd_respect_note')}</p>
      </Panel>

      {/* Top donors */}
      <Panel title={t('fd_donors_title')} icon="🏅" bodyClassName="p-0">
        {donors.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-zinc-500">{t('fd_donors_none')}</div>
        ) : (
          <>
            <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-7">{t('fam_col_member')}</div>
              <div className="col-span-4 text-right">{t('fam_col_donated')}</div>
            </div>
            {donors.map((m, i) => (
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
          </>
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500 px-1">
        {t('fd_bank_note')}{' '}
        <Link href="/families/bank" className="text-red-400 hover:underline">💰 {t('menu_family_bank')}</Link>
      </div>
    </div>
  );
}
