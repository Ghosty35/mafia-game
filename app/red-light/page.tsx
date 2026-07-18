'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import { CITIES } from '@/lib/cities';

type Bitch = {
  id: string;
  name: string;
  city: string;
  location: 'street' | 'red_light';
  addicted: boolean;
  loyalty: number;
  health: number;
  pending: number;
  rate: number;
  pot_cap: number;
};

type BitchData = {
  bitch_limit: number;
  count: number;
  bitch_limit_reached: boolean;
  rl_cap_total: number;
  rl_occupancy: Record<string, number>;
  pending_owner: number;
  pending_district: number;
  pending_total: number;
  rates: {
    buy_cost: number;
    buy_tax_rate: number;
    rl_placement_fee: number;
    street_rate: number;
    rl_rate: number;
    cap_hours: number;
    addicted_mult: number;
    rl_capacity: number;
  };
  bitches: Bitch[];
};

type RLDBank = {
  city: string;
  owner_id: string | null;
  is_owner: boolean;
  balance: number;
};

type OwnedRLD = { city: string; bank: RLDBank };

export default function RedLightPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language, fm } = useLanguage();
  const router = useRouter();

  const [data, setData] = useState<BitchData | null>(null);
  const [banks, setBanks] = useState<RLDBank[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [buyName, setBuyName] = useState('');
  const [buyCity, setBuyCity] = useState<string>(CITIES[0]);
  const [feedQty, setFeedQty] = useState(5);
  const [raidTarget, setRaidTarget] = useState('');
  const [depCity, setDepCity] = useState<string>(CITIES[0]);
  const [depAmount, setDepAmount] = useState(1000);

  const fmt = (n: number) =>
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));
  const coke = Math.floor(player?.drug_storage?.Coke ?? 0);

  const load = async () => {
    const supabase = createClient();
    const { data: d } = await supabase.rpc('get_my_bitches');
    if (d) setData(d as BitchData);
    // Load district banks for cities this player owns the redlight property in.
    const owned: RLDBank[] = [];
    await Promise.all(
      CITIES.map(async (c) => {
        const { data: b } = await supabase.rpc('get_rld_bank', { p_city: c });
        if (b && b.is_owner) owned.push(b as RLDBank);
      })
    );
    setBanks(owned);
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => PromiseLike<any>, okMsg?: (d: any) => string) => {
    setBusy(true);
    setMessage('');
    const { error, data: d } = await fn();
    if (error) {
      const m = error.message;
      if (m.includes('NOT_ENOUGH_CASH')) setMessage(t('rl_err_no_cash'));
      else if (m.includes('IN_JAIL')) setMessage(t('rl_err_in_jail'));
      else if (m.includes('DEAD')) setMessage(t('rl_err_dead'));
      else if (m.includes('BITCH_LIMIT')) setMessage(t('rl_err_limit'));
      else if (m.includes('RL_FULL')) setMessage(t('rl_err_rl_full'));
      else if (m.includes('BITCH_NOT_FOUND')) setMessage(t('rl_err_no_bitch'));
      else if (m.includes('NO_COKE')) setMessage(t('rl_err_no_coke'));
      else if (m.includes('NOTHING_TO_CLAIM')) setMessage(t('rl_err_nothing'));
      else if (m.includes('TARGET_NOT_FOUND')) setMessage(t('rl_err_not_found'));
      else if (m.includes('TARGET_HAS_NO_BITCHES')) setMessage(t('rl_err_no_target_bitches'));
      else if (m.includes('CANNOT_TARGET_SELF')) setMessage(t('rl_err_self'));
      else if (m.includes('NOT_RLD_OWNER')) setMessage(t('rl_err_not_owner'));
      else if (m.includes('RLD_INSUFFICIENT')) setMessage(t('rl_err_insufficient'));
      else if (m.includes('INVALID_AMOUNT')) setMessage(t('rl_err_invalid_amount'));
      else setMessage(m);
    } else if (okMsg && d) {
      setMessage(okMsg(d));
    }
    await load();
    if (refreshPlayer) await refreshPlayer();
    await router.refresh();
    setBusy(false);
  };

  if (!player) return <div className="p-6 text-zinc-400">{t('loading')}</div>;

  const rates = data?.rates;
  const streetRate = rates?.street_rate ?? 15;
  const rlRate = rates?.rl_rate ?? 20;
  const rlCap = data?.rl_cap_total ?? 50000;
  const limit = data?.bitch_limit ?? 25;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">🌃 {t('rl_title')}</h1>
        <p className="text-sm text-zinc-400">{t('rl_desc', { street: streetRate, rl: rlRate })}</p>
      </div>

      {message && (
        <div className="p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>
      )}

      {/* Summary + claim */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('rl_your_bitches')}</div>
          <div className="font-mono text-lg text-amber-400">{data?.count ?? 0}<span className="text-zinc-500 text-sm">/{limit}</span></div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('rl_pending_owner')}</div>
          <div className="font-mono text-lg text-rose-400">{data ? fm(data.pending_owner ?? data.pending_total) : '0'}</div>
          <div className="text-[9px] text-zinc-600 mt-0.5">{t('rl_street')}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('rl_pending_district')}</div>
          <div className="font-mono text-lg text-pink-400">{data ? fm(data.pending_district ?? 0) : '0'}</div>
          <div className="text-[9px] text-zinc-600 mt-0.5">{t('rl_window')}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('rl_capacity')}</div>
          <div className="font-mono text-lg text-pink-400">
            {fm(CITIES.reduce((s, c) => s + (data?.rl_occupancy?.[c] ?? 0), 0))}<span className="text-zinc-500 text-sm">/{fm(rlCap)}</span>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-center">
          <button
            onClick={() => run(async () => await createClient().rpc('claim_bitch_earnings'), (d) => t('rl_claimed_ok', { earned: fm(Number((d.owner_earned ?? d.earned) || 0)) }))}
            disabled={busy || (data?.pending_total ?? 0) <= 0}
            className="w-full py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 rounded font-bold text-sm"
          >
            {busy ? t('rl_claiming') : t('rl_claim_all')}
          </button>
        </div>
      </div>

      {/* Buy */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">💰 {t('rl_buy')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-zinc-400 mb-1">{t('rl_buy_name')}</label>
            <input
              value={buyName}
              onChange={(e) => setBuyName(e.target.value)}
              placeholder="—"
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-sm"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs text-zinc-400 mb-1">{t('rl_buy_city')}</label>
            <select
              value={buyCity}
              onChange={(e) => setBuyCity(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-sm"
            >
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            onClick={() => run(
              () => createClient().rpc('buy_bitch', { p_city: buyCity, p_name: buyName || null }),
              (d) => t('rl_bought', { name: d.name, city: d.city, tax: fmt(Number(d.tax)) })
            )}
            disabled={busy || (data?.bitch_limit_reached ?? false)}
            className="px-5 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded font-bold text-sm whitespace-nowrap"
          >
            {busy ? t('rl_buying') : `${t('rl_buy')} (${fm(rates?.buy_cost ?? 25000)})`}
          </button>
        </div>
        <div className="text-[11px] text-zinc-500">
          {t('rl_buy_tax')}: {rates ? `${Math.round((rates.buy_tax_rate) * 100)}%` : '2%'} → Gov Tax Bank
        </div>
      </div>

      {/* Bitch list */}
      <div>
        <h2 className="font-bold text-lg mb-3">👯 {t('rl_your_bitches')}</h2>
        {!data || data.bitches.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
            {t('rl_none')}
          </div>
        ) : (
          <div className="grid gap-3">
            {data.bitches.map((b) => {
              const inRL = b.location === 'red_light';
              const occupied = data.rl_occupancy?.[b.city] ?? 0;
              return (
                <div key={b.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-bold">
                        {b.name}
                        {b.addicted && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-800 text-white font-bold">{t('rl_addicted')}</span>}
                        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${inRL ? 'bg-pink-800 text-white' : 'bg-zinc-700 text-zinc-300'}`}>
                          {inRL ? `🌃 ${t('rl_window')}` : `🚶 ${t('rl_street')}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500">{b.city} · {t('rl_rate')} {b.rate}/hr</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-zinc-500">{t('rl_pending_total')}</div>
                      <div className="font-mono text-rose-400">{fm(b.pending)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-3 text-[11px]">
                    <div>
                      <div className="flex justify-between text-zinc-400"><span>{t('rl_loyalty')}</span><span className="font-mono text-amber-400">{b.loyalty}</span></div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1"><div className="h-full bg-amber-500" style={{ width: `${b.loyalty}%` }} /></div>
                    </div>
                    <div>
                      <div className="flex justify-between text-zinc-400"><span>{t('rl_health')}</span><span className="font-mono text-emerald-400">{b.health}</span></div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1"><div className="h-full bg-emerald-500" style={{ width: `${b.health}%` }} /></div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {inRL ? (
                      <button onClick={() => run(() => createClient().rpc('recall_bitch', { p_bitch_id: b.id }), (d) => t('rl_recalled', { name: d.name }))}
                        disabled={busy} className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-xs font-bold">
                        {t('rl_recall')}
                      </button>
                    ) : (
                      <button onClick={() => run(() => createClient().rpc('place_bitch_red_light', { p_bitch_id: b.id, p_city: b.city }), (d) => t('rl_placed', { name: d.name, city: d.city }))}
                        disabled={busy || (data?.rl_occupancy?.[b.city] ?? 0) >= rlCap}
                        className="px-3 py-1.5 rounded bg-pink-700 hover:bg-pink-600 disabled:opacity-40 text-xs font-bold">
                        {t('rl_place_rl')} ({fm(data?.rl_occupancy?.[b.city] ?? 0)}/{fm(rlCap)})
                      </button>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                      <input
                        type="number"
                        min={1}
                        max={coke}
                        value={feedQty}
                        onChange={(e) => setFeedQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono"
                      />
                      <button onClick={() => run(() => createClient().rpc('feed_bitch', { p_bitch_id: b.id, p_qty: feedQty }), (d) => t('rl_fed', { name: d.name, qty: d.coke_used }))}
                        disabled={busy || coke <= 0}
                        className="px-3 py-1.5 rounded bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-40 text-xs font-bold">
                        {t('rl_feed')} ({coke})
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* District banks (owner of a city's Red Light District property) */}
      {banks.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-bold text-lg">🏦 {t('rl_district_banks')}</h2>
          {banks.map((bk) => (
            <div key={bk.city} className="bg-zinc-900 border border-pink-900/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-bold">🌃 {bk.city} — {t('rl_district_bank')}</div>
                <div className="font-mono text-pink-400">{fm(bk.balance)}</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[160px]">
                  <label className="block text-xs text-zinc-400 mb-1">{t('rl_deposit_amount')}</label>
                  <input
                    type="number"
                    min={1}
                    value={depAmount}
                    onChange={(e) => setDepAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 w-full text-sm font-mono"
                  />
                </div>
                <button onClick={() => run(() => createClient().rpc('rld_deposit', { p_city: bk.city, p_amount: depAmount }), () => t('rl_deposited', { city: bk.city }))}
                  disabled={busy} className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-sm font-bold">
                  {t('rl_deposit_btn')}
                </button>
                <button onClick={() => run(() => createClient().rpc('rld_withdraw', { p_city: bk.city, p_amount: depAmount }), (d) => t('rl_withdrawn', { city: bk.city, amount: fm(Number(d.withdrawn)) }))}
                  disabled={busy || bk.balance <= 0} className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-sm font-bold">
                  {t('rl_withdraw_btn')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raid */}
      <div className="bg-zinc-900 border border-red-900/50 rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg text-red-400">⚔️ {t('rl_raid_title')}</h2>
        <p className="text-xs text-zinc-400">{t('rl_raid_desc')}</p>
        <div className="flex items-end gap-3 flex-wrap">
          <input
            value={raidTarget}
            onChange={(e) => setRaidTarget(e.target.value)}
            placeholder={t('rl_raid_target')}
            className="flex-1 min-w-[180px] bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
          />
          <button onClick={() => run(() => createClient().rpc('raid_bitches', { p_target_username: raidTarget }), (d) => {
            if (d.blocked) return t('rl_raided_blocked', { target: d.target });
            if (d.killed) return t('rl_raided_kill', { name: d.bitch_name, target: d.target, heat: d.new_heat });
            if (d.stole) return t('rl_raided_steal', { name: d.bitch_name, target: d.target, heat: d.new_heat });
            return t('rl_raided_fail', { heat: d.new_heat });
          })}
            disabled={busy || !raidTarget.trim()}
            className="px-5 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-40 rounded font-bold text-sm">
            {busy ? t('rl_raiding') : t('rl_raid_btn')}
          </button>
        </div>
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-red-400">← {t('rl_back')}</Link>
    </div>
  );
}
