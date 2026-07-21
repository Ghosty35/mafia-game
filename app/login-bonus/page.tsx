'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';
import { useEconomy } from '@/lib/economy';

type Reward = { cash: number; diamonds: number };
type BonusInfo = {
  streak: number;
  claimable: boolean;
  claimed_today: boolean;
  day_in_cycle: number;
  reward: Reward;
  is_donator: boolean;
  last_claim: string | null;
  daily_task?: {
    task_type: string;
    label: string;
    description: string;
    progress: number;
    target: number;
    completed: boolean;
  };
};

export const dynamic = 'force-dynamic';

// Daily login streak bonus (138). Reward cycles over 7 days; a missed day resets
// the streak. Server-authoritative — this page only reflects get_login_bonus.

export default function LoginBonusPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer, showToast } = usePlayer();
  const economy = useEconomy();
  const [info, setInfo] = useState<BonusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const CYCLE = economy?.login_bonus?.cycle ?? [10000, 20000, 35000, 50000, 75000, 100000, 150000];

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_login_bonus');
    if (data) setInfo(data as BonusInfo);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claim = async () => {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('claim_login_bonus');
    if (error) {
      if (error.message.includes('ALREADY_CLAIMED')) {
        showToast(t('lb_already'), 'error');
      } else if (error.message.includes('TASK_NOT_COMPLETE')) {
        showToast(t('lb_task_incomplete'), 'error');
      } else {
        showToast(t('common_error'), 'error');
      }
    } else {
      const d = data.diamonds > 0 ? t('lb_claimed_diamonds', { cash: fm(data.cash), diamonds: data.diamonds }) : t('lb_claimed', { cash: fm(data.cash) });
      showToast(d, 'success');
      if (refreshPlayer) await refreshPlayer();
      await load();
    }
    setBusy(false);
  };

  if (loading || !info) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const donatorMult = info.is_donator ? 1.5 : 1;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🎁 {t('lb_title')}</h1>
        <p className="text-xs text-zinc-400">{t('lb_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('lb_streak')}</div>
          <div className="font-mono font-bold text-2xl text-amber-400">🔥 {info.streak}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{info.claimable ? t('lb_todays_reward') : t('lb_next_reward')}</div>
          <div className="font-mono font-bold text-lg text-emerald-400">
            {fm(info.reward.cash)}{info.reward.diamonds > 0 && <span className="text-cyan-400"> + {info.reward.diamonds} 💎</span>}
          </div>
        </div>
      </div>

      {info.daily_task && (
        <Panel title={t('lb_task_title')} icon="🎯">
          <p className="text-xs text-zinc-400 mb-3">{t('lb_task_subtitle')}</p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-zinc-200">{info.daily_task.label}</span>
            <span className="text-xs text-zinc-400">{info.daily_task.description}</span>
          </div>
          <div className="w-full bg-zinc-950 rounded-full h-2.5 border border-zinc-800 overflow-hidden">
            <div
              className="bg-red-700 h-2.5 rounded-full transition-all"
              style={{ width: `${Math.min(100, (info.daily_task.progress / info.daily_task.target) * 100)}%` }}
            />
          </div>
          <p className={`text-xs mt-2 ${info.daily_task.completed ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {info.daily_task.completed ? t('lb_task_complete') : t('lb_task_incomplete')}
          </p>
        </Panel>
      )}

      <Panel title={t('lb_cycle_title')} icon="📅">
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {CYCLE.map((base, i) => {
            const day = i + 1;
            const isToday = info.day_in_cycle === day;
            const cash = Math.floor(base * donatorMult);
            return (
              <div
                key={day}
                className={`rounded-lg border p-2 text-center ${
                  isToday ? 'border-amber-600 bg-amber-950/20' : 'border-zinc-800 bg-zinc-950'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('lb_day', { day })}</div>
                <div className="text-[11px] font-mono text-emerald-400 mt-1">{fm(cash)}</div>
                {day === 7 && <div className="text-[10px] text-cyan-400">+5 💎</div>}
                {isToday && <div className="text-[9px] text-amber-400 mt-0.5 uppercase">{info.claimable ? t('lb_today') : t('lb_next')}</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <button
        onClick={claim}
        disabled={busy || !info.claimable}
        className="w-full py-3 rounded-xl font-bold text-sm tracking-wide bg-red-700 hover:bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
      >
        {info.claimable
          ? t('lb_claim_button', { cash: fm(info.reward.cash) })
          : info.claimed_today
            ? t('lb_already')
            : info.daily_task?.completed
              ? t('lb_claim_button', { cash: fm(info.reward.cash) })
              : t('lb_task_incomplete')}
      </button>

      {info.is_donator && <p className="text-[11px] text-amber-400 text-center">👑 {t('lb_donator_note')}</p>}
      <p className="text-[11px] text-zinc-500 text-center">{t('lb_footer')}</p>

      <Link href="/dashboard" className="inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
