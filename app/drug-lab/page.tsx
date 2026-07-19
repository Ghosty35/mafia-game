'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import { CITIES } from '@/lib/cities';

type Lab = {
  id: string;
  city: string;
  drug_type: string;
  level: number;
  pending: number;
  rate: number;
  last_collected: string;
  guards: number;
  raided_until: string | null;
  raid_pct: number;
};

type LabsData = {
  labs: Lab[];
  count: number;
  limit: number;
};

const DRUG_ICONS: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  Coke:  { icon: '💎', color: 'text-zinc-200',   bg: 'bg-zinc-800/50',   label: 'Cocaine' },
  Meth:  { icon: '🧪', color: 'text-sky-300',    bg: 'bg-sky-950/30',    label: 'Meth' },
  Pills: { icon: '💊', color: 'text-fuchsia-300', bg: 'bg-fuchsia-950/30', label: 'Pills' },
};

export default function DrugLabPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language, fm } = useLanguage();
  const router = useRouter();

  const [data, setData] = useState<LabsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [buyCity, setBuyCity] = useState<string>(CITIES[0]);
  const [buyDrug, setBuyDrug] = useState<string>('Coke');
  const [bribeMap, setBribeMap] = useState<Record<string, boolean>>({});

  const fmt = (n: number) =>
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));
  const drugStash = (type: string) => Math.floor(player?.drug_storage?.[type] ?? 0);

  const load = async () => {
    const supabase = createClient();
    const { data: d } = await supabase.rpc('get_my_druglabs');
    if (d) setData(d as LabsData);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, []);

  const run = async <T extends Record<string, unknown>>(
    fn: () => PromiseLike<{ error: { message: string } | null; data: unknown }>,
    okMsg?: (d: T) => string
  ) => {
    setBusy(true);
    setMessage('');
    const { error, data: d } = await fn();
    if (error) {
      const m = error.message;
      if (m.includes('NOT_ENOUGH_CASH')) setMessage(t('dl_err_no_cash'));
      else if (m.includes('IN_JAIL')) setMessage(t('dl_err_in_jail'));
      else if (m.includes('DEAD')) setMessage(t('dl_err_dead'));
      else if (m.includes('LAB_LIMIT')) setMessage(t('dl_err_limit'));
      else if (m.includes('LAB_CITY_LIMIT')) setMessage(t('dl_err_city_limit'));
      else if (m.includes('LAB_NOT_FOUND')) setMessage(t('dl_err_not_found'));
      else if (m.includes('NOTHING_TO_COLLECT')) setMessage(t('dl_err_nothing'));
      else if (m.includes('LAB_MAX_LEVEL')) setMessage(t('dl_err_max_level'));
      else if (m.includes('LAB_CAP_REACHED')) setMessage(t('dl_err_cap_reached'));
      else if (m.includes('LAB_RAIDED')) setMessage(t('dl_raided'));
      else if (m.includes('NOT_ENOUGH_CASH_BRIBE')) setMessage(t('dl_err_no_cash'));
      else if (m.includes('GUARDS_MAX')) setMessage(t('dl_guards_max'));
      else setMessage(m);
    } else if (okMsg && d) {
      setMessage(okMsg(d as T));
    }
    await load();
    if (refreshPlayer) await refreshPlayer();
    await router.refresh();
    setBusy(false);
  };

  if (!player) return <div className="p-6 text-zinc-400">{t('loading')}</div>;

  const limit = data?.limit ?? 1;
  const upgradeCost = (level: number) => 150000 * level;
  const GUARD_COSTS = [50000, 100000, 200000, 350000, 500000];
  const bribeFee = (pending: number) => Math.min(150000, 20000 + pending * 50);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">🧪 {t('dl_title')}</h1>
        <p className="text-sm text-zinc-400">{t('dl_desc')}</p>
      </div>

      {message && (
        <div className="p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dl_labs')}</div>
          <div className="font-mono text-lg text-amber-400">{data?.count ?? 0}<span className="text-zinc-500 text-sm">/{limit}</span></div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dl_coke')}</div>
          <div className="font-mono text-lg text-zinc-200">{drugStash('Coke')} kg</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dl_meth')}</div>
          <div className="font-mono text-lg text-sky-300">{drugStash('Meth')} kg</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('dl_pills')}</div>
          <div className="font-mono text-lg text-fuchsia-300">{drugStash('Pills')} kg</div>
        </div>
      </div>

      {/* Buy */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">🏗️ {t('dl_buy')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="block text-xs text-zinc-400 mb-1">{t('dl_buy_city')}</label>
            <select value={buyCity} onChange={(e) => setBuyCity(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-sm">
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs text-zinc-400 mb-1">{t('dl_buy_drug')}</label>
            <select value={buyDrug} onChange={(e) => setBuyDrug(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-sm">
              {Object.entries(DRUG_ICONS).map(([key, d]) => <option key={key} value={key}>{d.icon} {d.label}</option>)}
            </select>
          </div>
          <button
            onClick={() => run(
              () => createClient().rpc('buy_druglab', { p_city: buyCity, p_drug_type: buyDrug }),
              () => t('dl_bought', { city: buyCity, drug: DRUG_ICONS[buyDrug]?.label ?? buyDrug, cost: fm(200000) })
            )}
            disabled={busy || (data?.count ?? 0) >= limit}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded font-bold text-sm whitespace-nowrap"
          >
            {busy ? t('dl_buying') : `${t('dl_buy')} (${fm(200000)})`}
          </button>
        </div>
        <div className="text-[11px] text-zinc-500">
          {t('dl_buy_tax')}: 2% → Gov Tax Bank
        </div>
      </div>

      {/* Lab List */}
      <div>
        <h2 className="font-bold text-lg mb-3">🧪 {t('dl_labs')}</h2>
        {!data || data.labs.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
            {t('dl_none')}
          </div>
        ) : (
          <div className="grid gap-3">
            {data.labs.map((lab) => {
              const meta = DRUG_ICONS[lab.drug_type] ?? DRUG_ICONS['Coke'];
              const pending = lab.pending ?? 0;
              const canUpgrade = lab.level < 10;
              const upgCost = upgradeCost(lab.level);
              const isRaided = lab.raided_until && new Date(lab.raided_until).getTime() > Date.now();
              const raidLeft = isRaided ? Math.max(0, Math.ceil((new Date(lab.raided_until!).getTime() - Date.now()) / 60000)) : 0;
              const guards = lab.guards ?? 0;
              const raidPct = lab.raid_pct ?? 0;
              const nextGuardCost = guards < 5 ? GUARD_COSTS[guards] : 0;
              const doBribe = bribeMap[lab.id] ?? false;
              const bribeCostVal = pending > 0 ? bribeFee(pending) : 0;
              return (
                <div key={lab.id} className={`${meta.bg} border ${isRaided ? 'border-red-800' : 'border-zinc-800'} rounded-xl p-4`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-bold">
                        {meta.icon} {lab.city} — {meta.label}
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">Lv {lab.level}</span>
                        {isRaided && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-300 font-bold">{t('dl_raided')} {raidLeft}m</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500">{t('dl_rate')} {lab.rate}/hr · {t('dl_pending')} {fmt(pending)} kg</div>
                      <div className="text-[11px] text-zinc-500">{t('dl_guards')}: {guards}/5 · {t('dl_raid_risk')}: {raidPct}%</div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {!isRaided && (
                        <>
                          <button
                            onClick={() => run(
                              () => createClient().rpc('hire_lab_guards', { p_lab_id: lab.id }),
                              (d) => t('dl_hire_guards')
                            )}
                            disabled={busy || guards >= 5 || (player.cash ?? 0) < nextGuardCost}
                            className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-xs font-bold"
                          >
                            {t('dl_hire_guards')} ({nextGuardCost ? fm(nextGuardCost) : t('dl_guards_max')})
                          </button>
                          <button
                            onClick={() => run(
                              () => createClient().rpc('collect_druglab', { p_lab_id: lab.id, p_bribe: doBribe }),
                              (d) => {
                                if (d.raided) {
                                  return t('dl_raided_collect', { seized: fmt(Number(d.seized)), drug: meta.label });
                                }
                                return t('dl_collected', { drug: meta.label, amount: fmt(Number(d.collected)) });
                              }
                            )}
                            disabled={busy || pending <= 0}
                            className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-bold"
                          >
                            {t('dl_collect')}
                          </button>
                          {pending > 0 && (
                            <label className="flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={doBribe}
                                onChange={(e) => setBribeMap((p) => ({ ...p, [lab.id]: e.target.checked }))}
                                className="accent-amber-600"
                              />
                              {t('dl_bribe')} {bribeCostVal > 0 && <span className="text-amber-400">({fm(bribeCostVal)}, {t('dl_bribe_chance', { pct: 60 })})</span>}
                            </label>
                          )}
                        </>
                      )}
                      {isRaided && (
                        <span className="text-xs text-red-400 font-mono">{t('dl_raided_until', { time: `${raidLeft}m` })}</span>
                      )}
                      {canUpgrade && !isRaided && (
                        <button
                          onClick={() => run(
                            () => createClient().rpc('upgrade_druglab', { p_lab_id: lab.id }),
                            (d) => t('dl_upgraded', { level: Number(d.new_level), cost: fmt(Number(d.cost)) })
                          )}
                          disabled={busy || player.cash < upgCost}
                          className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-xs font-bold"
                        >
                          {t('dl_upgrade')} ({fmt(upgCost)})
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-red-400">← {t('dl_back')}</Link>
    </div>
  );
}
