'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';

interface ServerStats {
  online_people: number;
  logged_in_this_week: number;
  total_families: number;
  total_family_members: number;
  total_money_circulation: number;
  people_registered: number;
}

export default function ServerStatusPage() {
  const { t, fm } = useLanguage();
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadStats = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_server_stats');
    if (error || !data) {
      // No made-up numbers: show the failure honestly.
      setFailed(true);
    } else {
      setFailed(false);
      setStats({
        online_people: data.online_people ?? 0,
        logged_in_this_week: data.logged_in_this_week ?? 0,
        total_families: data.total_families ?? 0,
        total_family_members: data.total_family_members ?? 0,
        total_money_circulation: data.total_money_circulation ?? 0,
        people_registered: data.people_registered ?? 0,
      });
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    // Standard data-fetching effect on mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats();
    const interval = setInterval(loadStats, 25000); // live refresh
    return () => clearInterval(interval);
  }, []);

  const activityPct = stats && stats.people_registered > 0
    ? Math.min(100, Math.round((stats.logged_in_this_week / stats.people_registered) * 100))
    : 0;

  const statCards = stats
    ? [
        { label: t('status_week'), value: stats.logged_in_this_week.toLocaleString(), icon: '📅', sub: t('status_week_sub'), color: 'text-sky-400' },
        { label: t('status_families'), value: stats.total_families.toLocaleString(), icon: '👑', sub: t('status_families_sub'), color: 'text-amber-400' },
        { label: t('status_members'), value: stats.total_family_members.toLocaleString(), icon: '👥', sub: t('status_members_sub'), color: 'text-orange-400' },
        { label: t('status_money'), value: fm(stats.total_money_circulation), icon: '💵', sub: t('status_money_sub'), color: 'text-emerald-400' },
        { label: t('status_registered'), value: stats.people_registered.toLocaleString(), icon: '📋', sub: t('status_registered_sub'), color: 'text-zinc-200' },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🖥️ {t('status_title')}</h1>
          <p className="text-xs text-zinc-400">{t('status_subtitle')}</p>
        </div>
        <div className="text-right">
          <button
            onClick={loadStats}
            disabled={loading}
            className="px-4 py-2 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50"
          >
            {loading ? t('status_refreshing') : t('status_refresh')}
          </button>
          {lastUpdated && (
            <p className="text-[10px] text-zinc-500 mt-1">{t('status_last_updated', { time: lastUpdated.toLocaleTimeString() })}</p>
          )}
        </div>
      </div>

      {failed && (
        <div className="bg-amber-950/50 border border-amber-800 text-amber-300 rounded-xl px-4 py-3 text-sm">
          {t('status_unavailable')}
        </div>
      )}

      {loading && !stats ? (
        <div className="text-center py-12 text-zinc-400 text-sm">{t('status_loading')}</div>
      ) : stats ? (
        <>
          {/* Hero: live player count */}
          <div className="bg-gradient-to-br from-emerald-950/60 to-zinc-900 border border-emerald-900/60 rounded-xl px-6 py-6 flex items-center gap-5">
            <div className="relative shrink-0">
              <span className="block w-4 h-4 rounded-full bg-emerald-500" />
              <span className="absolute inset-0 w-4 h-4 rounded-full bg-emerald-500 animate-ping opacity-60" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[2px] text-emerald-400 font-bold">{t('status_online')}</div>
              <div className="text-4xl font-black font-mono tabular-nums">{stats.online_people.toLocaleString()}</div>
              <div className="text-xs text-zinc-400 mt-0.5">{t('status_online_sub')}</div>
            </div>
            <div className="hidden sm:block text-right w-44">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('status_weekly_activity')}</div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${activityPct}%` }} />
              </div>
              <div className="text-[11px] text-zinc-400 mt-1 font-mono">{activityPct}%</div>
            </div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {statCards.map((card, idx) => (
              <div key={idx} className="card p-5 border border-zinc-800 hover:border-red-900/40 transition">
                <div className="flex items-start gap-3">
                  <div className="text-3xl mt-0.5">{card.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-[1px] text-zinc-500 mb-1">{card.label}</div>
                    <div className={`text-2xl font-bold font-mono tabular-nums mb-1 break-all ${card.color}`}>{card.value}</div>
                    <div className="text-[11px] text-zinc-400">{card.sub}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <Panel title={t('status_how_title')} icon="ℹ️">
        <ul className="space-y-1.5 text-xs text-zinc-400 list-disc pl-5">
          <li><span className="text-white">{t('status_how_1_label')}</span> {t('status_how_1_text')}</li>
          <li><span className="text-white">{t('status_how_2_label')}</span> {t('status_how_2_text')}</li>
          <li><span className="text-white">{t('status_how_3_label')}</span> {t('status_how_3_text')}</li>
          <li>{t('status_how_4')}</li>
        </ul>
        <p className="mt-3 text-[10px] text-zinc-500">{t('status_footer')}</p>
      </Panel>

      <div>
        <Link href="/dashboard" className="text-sm text-red-400 hover:underline">← {t('common_back_dashboard')}</Link>
      </div>
    </div>
  );
}
