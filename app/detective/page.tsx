'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';
import { useRouter } from 'next/navigation';

type Search = {
  id: string;
  target: string;
  requested_at: string;
  ready_at: string;
  found_city: string | null;
  delivered: boolean;
  expires_at: string | null;
  target_city_now: string | null;
};

type DetectiveInfo = {
  searches: Search[];
  cost: number;
  my_city: string;
};

export const dynamic = 'force-dynamic';

// Detective Agency (076): a real 15-minute server-side search. The report
// lands in Messages and the intel stays warm for 5 minutes — long enough to
// travel to the target's city and act.
export default function DetectivePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [info, setInfo] = useState<DetectiveInfo | null>(null);
  const [targetName, setTargetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_my_detective');
    if (data) setInfo(data as DetectiveInfo);
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  // Poll so a finished search delivers itself while the page is open.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 15000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load]);

  const hire = async () => {
    if (!targetName.trim()) return;
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('hire_detective', { p_target_username: targetName.trim() });
    setBusy(false);
    if (error) {
      const m = error.message || '';
      if (m.includes('TARGET_NOT_FOUND')) setMessage(t('dt_err_not_found'));
      else if (m.includes('CANNOT_TARGET_SELF')) setMessage(t('dt_err_self'));
      else if (m.includes('SEARCH_IN_PROGRESS')) setMessage(t('dt_err_in_progress'));
      else if (m.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (m.includes('IN_JAIL')) setMessage(t('error_in_jail'));
      else if (m.includes('DEAD')) setMessage(t('travel_dead'));
      else setMessage(t('dt_err_hire'));
      return;
    }
    setTargetName('');
    await refreshPlayer();
    await router.refresh();
    await load();
    setMessage(t('dt_hired', { target: data.target, cost: fm(data.cost) }));
  };

  if (!player || !info) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const secsUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const pending = info.searches.find((s) => !s.delivered);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🕵️ {t('dt_title')}</h1>
        <p className="text-xs text-zinc-400">{t('dt_subtitle')}</p>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* How it works */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400">
        <span className="text-white font-semibold">{t('dt_how_title')}</span> {t('dt_how_text', { cost: fm(info.cost) })}
      </div>

      {/* Hire */}
      <Panel title={t('dt_hire_title')} icon="🔍">
        {pending ? (
          <div className="text-center py-3">
            <div className="text-sm text-zinc-300 mb-1">{t('dt_tailing', { target: pending.target })}</div>
            <div className="font-mono text-3xl text-amber-400 tabular-nums">{mmss(secsUntil(pending.ready_at))}</div>
            <div className="text-[11px] text-zinc-500 mt-1">{t('dt_report_when_done')}</div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              placeholder={t('dt_placeholder')}
              className="flex-1 min-w-48 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={hire}
              disabled={busy || !targetName.trim()}
              className="px-5 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              🔍 {t('dt_hire_button', { cost: fm(info.cost) })}
            </button>
          </div>
        )}
      </Panel>

      {/* Reports */}
      <Panel title={t('dt_reports_title')} icon="📁" bodyClassName="p-0">
        {info.searches.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('dt_no_reports')}</div>
        ) : (
          info.searches.map((s) => {
            const expiresIn = s.expires_at ? secsUntil(s.expires_at) : 0;
            const warm = s.delivered && expiresIn > 0;
            const sameCity = warm && s.target_city_now === info.my_city;

            return (
              <div key={s.id} className="border-t first:border-t-0 border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">
                      🎯 {s.target}
                      {warm && (
                        <span className="ml-2 text-[10px] px-1.5 py-px bg-emerald-900/60 text-emerald-300 rounded uppercase">
                          {t('dt_warm')}
                        </span>
                      )}
                      {s.delivered && !warm && (
                        <span className="ml-2 text-[10px] px-1.5 py-px bg-zinc-800 text-zinc-500 rounded uppercase">
                          {t('dt_cold')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {s.delivered ? t('dt_found_at', { city: s.found_city ?? '?' }) : t('dt_searching')}
                    </div>
                  </div>

                  {warm && (
                    <>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('dt_expires')}</div>
                        <div className={`font-mono tabular-nums text-sm ${expiresIn < 60 ? 'text-red-400' : 'text-amber-400'}`}>
                          {mmss(expiresIn)}
                        </div>
                      </div>
                      {sameCity ? (
                        <Link
                          href={`/murder?target=${encodeURIComponent(s.target)}`}
                          className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-semibold"
                        >
                          🔫 {t('dt_act_now')}
                        </Link>
                      ) : (
                        <Link
                          href="/travel"
                          className="px-4 py-2 bg-amber-800 hover:bg-amber-700 rounded-lg text-xs font-semibold"
                        >
                          🧭 {t('dt_travel_there', { city: s.target_city_now ?? s.found_city ?? '?' })}
                        </Link>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">
        {t('dt_footer')} <Link href="/messages" className="text-red-400 hover:underline">✉️ {t('menu_messages')}</Link>
      </div>
    </div>
  );
}
