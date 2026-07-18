'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import { usePlayer } from '../components/PlayerContext';
import Panel from '../components/Panel';

type Task = {
  id: string;
  type: string;
  target: number;
  progress?: number;
  reward_money: number;
  reward_xp: number;
  reward_respect: number;
};

type FamilyTask = {
  type: string;
  target: number;
  progress: number;
  power: number;
} | null;

type HustlerData = {
  daily_tasks: Task[];
  daily_claimed: string[];
  daily_date: string;
  weekly_tasks: Task[];
  weekly_claimed: string[];
  weekly_num: number;
  family_task: FamilyTask;
  family_claimed: boolean;
  family_week: number;
  daily_streak: number;
  last_daily_date: string | null;
  total_xp: number;
  hustler_rank: number;
  next_reset: string;
};

const TASK_ICON: Record<string, string> = {
  crime: '🔫',
  heist: '💣',
  drug_buy: '🧪',
  drug_sell: '💊',
  casino: '🎰',
  race: '🏁',
  murder: '🔥',
  launder: '🧼',
  coop_crime: '🤝',
  coop_heist: '🤝',
};

const RANK_LABEL = ['', 'Bronze Hustler', 'Silver Hustler', 'Gold Hustler'];

function useCountdown(target?: string) {
  const iso = target ?? '2030-01-01T00:00:00Z';
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [iso]);
  const s = Math.ceil(left / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

export default function HustlersWayPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const [tab, setTab] = useState<'daily' | 'weekly' | 'family'>('daily');
  const [data, setData] = useState<HustlerData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    supabase.rpc('get_hustler_tasks').then(({ data: d }) => {
      if (active && d) setData(d as HustlerData);
    });
    return () => {
      active = false;
    };
  }, []);

  const claim = async (scope: 'daily' | 'weekly' | 'family', taskId?: string) => {
    const key = `${scope}:${taskId ?? 'f'}`;
    setBusy(key);
    setMsg(null);
    const supabase = createClient();
    const { data: res, error } = await supabase.rpc('claim_hustler_task', {
      p_scope: scope,
      p_task_id: taskId ?? '',
    });
    if (error) {
      if (error.message.includes('NOT_COMPLETE')) setMsg(t('hw_not_complete'));
      else if (error.message.includes('ALREADY_CLAIMED')) setMsg(t('hw_already'));
      else if (error.message.includes('NOT_IN_FAMILY')) setMsg(t('hw_no_family'));
      else setMsg(t('hw_claim_fail'));
    } else {
      const r = res as {
        reward_money: number;
        reward_xp: number;
        reward_respect: number;
        item?: { item: string | null; label?: string } | null;
      } | null;
      if (!r) {
        setMsg(t('hw_claim_fail'));
      } else {
        let line = t('hw_claimed', { money: fm(r.reward_money), xp: r.reward_xp });
        if (r.reward_respect) line += ' · ' + t('hw_respect', { r: r.reward_respect });
        if (r.item && r.item.item) line += ' · 🎁 ' + r.item.label;
        setMsg(line);
        await refreshPlayer();
        const { data: d2 } = await supabase.rpc('get_hustler_tasks');
        if (d2) setData(d2 as HustlerData);
      }
    }
    setBusy(null);
  };

  const countdown = useCountdown(data?.next_reset);


  const TaskRow = ({ task, scope }: { task: Task; scope: 'daily' | 'weekly' }) => {
    const claimed = (scope === 'daily' ? data?.daily_claimed : data?.weekly_claimed)?.includes(task.id);
    const prog = task.progress ?? 0;
    const pct = Math.min(100, Math.round((prog / task.target) * 100));
    const done = prog >= task.target;
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{TASK_ICON[task.type] ?? '🎯'}</span>
            <span className="font-semibold text-sm">{t(('hw_t_' + task.type) as TranslationKey)}</span>
          </div>
          <span className="text-xs font-mono text-zinc-400">{prog}/{task.target}</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
          <div className={`h-full ${done ? 'bg-emerald-500' : 'bg-amber-500'} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {t('hw_reward')}: <span className="text-emerald-400">{fm(task.reward_money)}</span> ·{' '}
            <span className="text-sky-400">{task.reward_xp} XP</span>
            {task.reward_respect > 0 && <> · <span className="text-rose-400">{task.reward_respect} {t('hw_respect_short')}</span></>}
          </div>
          <button
            disabled={busy !== null || claimed || !done}
            onClick={() => claim(scope, task.id)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {claimed ? t('hw_claimed_btn') : busy === `${scope}:${task.id}` ? t('hw_claiming') : t('hw_claim')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🛤️ {t('hw_title')}</h1>
        <p className="text-xs text-zinc-400">{t('hw_desc')}</p>
      </div>

      {msg && <div className="bg-zinc-900 border border-amber-800/50 rounded-xl px-4 py-3 text-sm text-amber-300">{msg}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
          <div className="text-[10px] uppercase text-zinc-500">{t('hw_streak')}</div>
          <div className="text-lg font-bold text-amber-400">{data?.daily_streak ?? 0} 🔥</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
          <div className="text-[10px] uppercase text-zinc-500">{t('hw_rank')}</div>
          <div className="text-sm font-bold text-amber-300">{RANK_LABEL[data?.hustler_rank ?? 0] || '-'}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
          <div className="text-[10px] uppercase text-zinc-500">{t('hw_total_xp')}</div>
          <div className="text-lg font-bold text-sky-400">{fm(data?.total_xp ?? 0)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
          <div className="text-[10px] uppercase text-zinc-500">{t('hw_resets_in')}</div>
          <div className="text-sm font-bold text-zinc-200 font-mono">{countdown}</div>
        </div>
      </div>

      <div className="flex gap-2">
        {(['daily', 'weekly', 'family'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === tb ? 'bg-amber-600 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t(('hw_tab_' + tb) as TranslationKey)}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="text-center text-zinc-500 py-10">{t('hw_loading')}</div>
      ) : tab === 'daily' ? (
        <div className="space-y-3">
          {data.daily_tasks.map((task) => (
            <TaskRow key={task.id} task={task} scope="daily" />
          ))}
        </div>
      ) : tab === 'weekly' ? (
        <div className="space-y-3">
          {data.weekly_tasks.map((task) => (
            <TaskRow key={task.id} task={task} scope="weekly" />
          ))}
          <p className="text-[11px] text-zinc-500 text-center">{t('hw_coop_note')}</p>
        </div>
      ) : (
        <Panel title={t('hw_family_title')} icon="👥" variant="default">
          {!data.family_task ? (
            <p className="text-sm text-zinc-400">{t('hw_no_family_task')}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">{t('hw_family_desc')}</p>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TASK_ICON[data.family_task.type] ?? '👥'}</span>
                    <span className="font-semibold text-sm">{t(('hw_t_' + data.family_task.type) as TranslationKey)}</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">{data.family_task.progress}/{data.family_task.target}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full ${data.family_task.progress >= data.family_task.target ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, Math.round((data.family_task.progress / data.family_task.target) * 100))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-zinc-400">
                    {t('hw_family_reward')}: <span className="text-amber-400">+{data.family_task.power} {t('hw_power')}</span>
                  </div>
                  <button
                    disabled={busy !== null || data.family_claimed || data.family_task.progress < data.family_task.target}
                    onClick={() => claim('family')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {data.family_claimed ? t('hw_claimed_btn') : busy === 'family:f' ? t('hw_claiming') : t('hw_claim')}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">{t('hw_family_note')}</p>
            </div>
          )}
        </Panel>
      )}
    </main>
  );
}
