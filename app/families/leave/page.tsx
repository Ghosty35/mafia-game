'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';

type LeaveInfo = {
  in_family: boolean;
  family_name?: string;
  family_tag?: string;
  my_role?: string;
  fee?: number;
  can_afford?: boolean;
  blocked_as_boss?: boolean;
  others?: number;
  bounty_days?: number;
};

export const dynamic = 'force-dynamic';

// Leave Family (077): walking away costs a fee — and that exact fee becomes
// the bounty your former crew (and only them) can collect on your head.
export default function LeaveFamilyPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const router = useRouter();

  const [info, setInfo] = useState<LeaveInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ fee: number; bounty: number } | null>(null);

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_leave_info');
    if (data) setInfo(data as LeaveInfo);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const leave = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('leave_family');
    setBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('BOSS_MUST_HAND_OVER')) setError(t('lv_err_boss'));
      else if (m.includes('NOT_ENOUGH_CASH')) setError(t('lv_err_cash'));
      else if (m.includes('NOT_IN_FAMILY')) setError(t('lv_err_not_in'));
      else setError(t('lv_err_generic'));
      return;
    }
    setDone({ fee: data.fee, bounty: data.bounty_amount });
    setConfirming(false);
    if (refreshPlayer) await refreshPlayer();
    await load();
    router.refresh();
  };

  if (!info) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  if (done) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">🚪 {t('lv_title')}</h1>
        <Panel title={t('lv_done_title')} icon="🩸">
          <p className="text-sm text-zinc-300 mb-3">{t('lv_done_text', { fee: fm(done.fee) })}</p>
          {done.bounty > 0 && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
              🎯 {t('lv_done_bounty', { amount: fm(done.bounty) })}
            </div>
          )}
          <Link href="/families/join" className="inline-block mt-4 px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            {t('fam_none_join')}
          </Link>
        </Panel>
      </div>
    );
  }

  if (!info.in_family) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('lv_title')} icon="🚪">
          <p className="text-sm text-zinc-300 mb-4">{t('lv_not_in_family')}</p>
          <Link href="/families/join" className="inline-block px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            {t('fam_none_join')}
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🚪 {t('lv_title')}</h1>
        <p className="text-xs text-zinc-400">{t('lv_subtitle', { family: info.family_name ?? '' })}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {/* The deal */}
      <Panel title={t('lv_the_deal')} icon="🩸">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lv_exit_fee')}</div>
            <div className="font-mono font-bold text-xl text-red-400 tabular-nums">{fm(info.fee ?? 0)}</div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lv_bounty_on_you')}</div>
            <div className="font-mono font-bold text-xl text-amber-400 tabular-nums">{fm(info.fee ?? 0)}</div>
          </div>
        </div>

        <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
          <li>{t('lv_rule_fee')}</li>
          <li>{t('lv_rule_bounty', { days: info.bounty_days ?? 7 })}</li>
          <li>{t('lv_rule_who')}</li>
          <li>{t('lv_rule_rejoin')}</li>
        </ul>
      </Panel>

      {/* Action */}
      {info.blocked_as_boss ? (
        <div className="bg-amber-950/50 border border-amber-800 text-amber-300 rounded-xl px-4 py-3 text-sm">
          👑 {t('lv_boss_blocked', { count: info.others ?? 0 })}{' '}
          <Link href="/families" className="text-red-400 hover:underline">{t('menu_my_family')}</Link>
        </div>
      ) : !info.can_afford ? (
        <div className="bg-amber-950/50 border border-amber-800 text-amber-300 rounded-xl px-4 py-3 text-sm">
          💸 {t('lv_cant_afford', { fee: fm(info.fee ?? 0) })}
        </div>
      ) : !confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="w-full py-3 bg-zinc-900 border border-red-900 hover:border-red-600 hover:text-red-400 rounded-xl text-sm font-semibold"
        >
          🚪 {t('lv_button', { fee: fm(info.fee ?? 0) })}
        </button>
      ) : (
        <div className="bg-red-950/40 border border-red-800 rounded-xl px-4 py-4">
          <p className="text-sm text-red-200 mb-3">
            {t('lv_confirm_text', { family: info.family_name ?? '', fee: fm(info.fee ?? 0), amount: fm(info.fee ?? 0) })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={leave}
              disabled={busy}
              className="flex-1 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              {busy ? t('lv_leaving') : t('lv_confirm_yes')}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm"
            >
              {t('common_cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
