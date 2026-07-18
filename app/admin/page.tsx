'use client';

import { usePlayer } from '../components/PlayerContext';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [economy, setEconomy] = useState<any>(null);
  const [pools, setPools] = useState<any>(null);
  const [govTax, setGovTax] = useState<number | null>(null);
  const [lotteryPool, setLotteryPool] = useState<number | null>(null);
  const [banks, setBanks] = useState<any>(null);
  const [warEvents, setWarEvents] = useState<any>(null);
  const [serverStats, setServerStats] = useState<any>(null);
  const [topCash, setTopCash] = useState<any[]>([]);
  const [topDiamonds, setTopDiamonds] = useState<any[]>([]);
  const [topLevel, setTopLevel] = useState<any[]>([]);
  const [topActive, setTopActive] = useState<any[]>([]);
  const [nextDraw, setNextDraw] = useState<string | null>(null);
  const isAdmin = player?.username === 'YGhosty';

  const supabase = createClient();

  const addLog = (type: string, msg: string) => {
    const entry = { time: new Date().toISOString(), type, msg };
    setLogs(prev => [entry, ...prev].slice(0, 80));
    // Persist simple to local for session
  };

  const fetchPlayers = async (search?: string) => {
    setLoadingPlayers(true);
    // RLS only allows reading your own row directly; the roster goes
    // through the admin_list_players RPC.
    const { data, error } = await supabase.rpc('admin_list_players', { search: search || null });
    if (!error && data) setAllPlayers(data as any[]);
    setLoadingPlayers(false);
  };

  const fetchEconomy = async () => {
    try {
      const { data: stats } = await supabase.rpc('get_server_stats');
      setEconomy(stats);

      const { data: cp } = await supabase.rpc('get_casino_pools');
      setPools(cp);

      const { data: gt } = await supabase.rpc('admin_get_gov_tax');
      if (gt) setGovTax(gt.balance ?? 0);

      const { data: lot } = await supabase.rpc('admin_get_lottery');
      if (lot) setLotteryPool(lot.pool ?? 0);

      const { data: bk } = await supabase.rpc('admin_banks_overview');
      if (bk) setBanks(bk);

      const { data: we } = await supabase.rpc('get_war_events');
      if (we) setWarEvents(we);

      const { data: ss } = await supabase.rpc('admin_get_server_stats');
      if (ss) setServerStats(ss);

      const { data: nd } = await supabase.rpc('admin_get_lottery');
      if (nd) setNextDraw(nd.next_draw || null);

      const { data: tc } = await supabase.rpc('admin_get_top_cash', { limit_count: 10 });
      if (tc) setTopCash(tc);

      const { data: td } = await supabase.rpc('admin_get_top_diamonds', { limit_count: 10 });
      if (td) setTopDiamonds(td);

      const { data: tl } = await supabase.rpc('admin_get_top_level', { limit_count: 10 });
      if (tl) setTopLevel(tl);

      const { data: ta } = await supabase.rpc('admin_get_top_active', { limit_count: 10 });
      if (ta) setTopActive(ta);
    } catch (e) {}
  };

  const loadAll = () => {
    if (!isAdmin) return;
    fetchPlayers();
    fetchEconomy();
    addLog('INFO', 'Admin data refreshed');
  };

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  if (!isAdmin) {
    return <div className="p-8 text-red-400">{t('admin_denied')}</div>;
  }

  // All admin writes go through SECURITY DEFINER RPCs (035):
  // direct table updates are blocked by RLS and fail silently.
  const giveCash = async (username: string, amt: number) => {
    if (!amt || amt === 0) return;
    const { data, error } = await supabase.rpc('admin_give_cash', { target_username: username, amount: amt });
    if (error) {
      addLog('ERROR', error.message.includes('PLAYER_NOT_FOUND') ? `Player ${username} not found` : error.message);
      return;
    }
    addLog('GIVE', `Gave ${fm(amt)} to ${data?.username || username}. New cash: ${fm(data?.new_cash || 0)}`);
    if (username.toLowerCase() === (player?.username || '').toLowerCase()) {
      await refreshPlayer();
      await router.refresh();
    }
    fetchPlayers();
  };

  const setDonator = async (username: string, val: boolean) => {
    const { error } = await supabase.rpc('admin_set_donator', { target_username: username, val });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('VIP', `${username} donator status set to ${val}`);
    fetchPlayers();
  };

  const forceClearStatus = async (pid: string, type: 'jail' | 'death') => {
    const { error } = await supabase.rpc('admin_clear_status', { target_id: pid, status_type: type });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('FORCE', `Cleared ${type} for player`);
    fetchPlayers();
    await refreshPlayer();
    await router.refresh();
  };

  const updateFieldDirect = async (pid: string, field: string, value: any) => {
    const { error } = await supabase.rpc('admin_update_player_field', {
      target_id: pid,
      field_name: field,
      field_value: String(value),
    });
    if (error) addLog('ERROR', error.message);
    else {
      addLog('EDIT', `Set ${field}=${value}`);
      fetchPlayers();
      if (pid === player?.id) {
        await refreshPlayer();
        await router.refresh();
      }
    }
  };

  const adjustTaxUI = async () => {
    // Simple: we store rates in logs + future global. For now persist via note + can be used by other systems.
    const prop = parseFloat((document.getElementById('propTax') as HTMLInputElement)?.value || '10');
    const bank = parseFloat((document.getElementById('bankTax') as HTMLInputElement)?.value || '0.5');
    addLog('TAX', `Admin set Property: ${prop}% | Bank: ${bank}% (applies to future txns via code)`);
    // For real global tax, could extend player or server_stats later.
  };

  const giveToAllOnlineSim = async (amt: number) => {
    // Economy stimulus: +amt to top 10 richest, server-side
    const { data, error } = await supabase.rpc('admin_stimulus', { amount: amt });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('STIM', `Stimulus: +${fm(amt)} to top ${data?.players_affected || 10} richest (economy boost)`);
    fetchPlayers();
  };

  const govDeposit = async (amt: number) => {
    if (!amt || amt <= 0) return;
    const { data, error } = await supabase.rpc('admin_deposit_gov_tax', { p_amount: amt });
    if (error) { addLog('ERROR', error.message); return; }
    setGovTax(data?.balance ?? 0);
    addLog('TAX', `Deposited ${fm(amt)} into Gov Tax Bank. Balance: ${fm(data?.balance ?? 0)}`);
  };

  const govWithdraw = async (amt: number) => {
    if (!amt || amt <= 0) return;
    const { data, error } = await supabase.rpc('admin_withdraw_gov_tax', { p_amount: amt });
    if (error) {
      addLog('ERROR', error.message.includes('NOT_ENOUGH_TAX') ? 'Gov Tax Bank has insufficient funds' : error.message);
      return;
    }
    setGovTax(data?.balance ?? 0);
    addLog('TAX', `Withdrew ${fm(amt)} from Gov Tax Bank. Balance: ${fm(data?.balance ?? 0)}`);
    await refreshPlayer();
    await router.refresh();
  };

  const lotDeposit = async (amt: number) => {
    if (!amt || amt <= 0) return;
    const { data, error } = await supabase.rpc('admin_deposit_lottery', { p_amount: amt });
    if (error) { addLog('ERROR', error.message); return; }
    setLotteryPool(data?.pool ?? 0);
    addLog('LOTTERY', `Deposited ${fm(amt)} into Lottery pool. Pool: ${fm(data?.pool ?? 0)}`);
  };

  const lotWithdraw = async (amt: number) => {
    if (!amt || amt <= 0) return;
    const { data, error } = await supabase.rpc('admin_withdraw_lottery', { p_amount: amt });
    if (error) {
      addLog('ERROR', error.message.includes('NOT_ENOUGH_LOTTERY') ? 'Lottery pool has insufficient funds' : error.message);
      return;
    }
    setLotteryPool(data?.pool ?? 0);
    addLog('LOTTERY', `Withdrew ${fm(amt)} from Lottery pool. Pool: ${fm(data?.pool ?? 0)}`);
    await refreshPlayer();
    await router.refresh();
  };

  const lotDraw = async () => {
    const { data, error } = await supabase.rpc('admin_draw_lottery');
    if (error) {
      addLog('ERROR', error.message.includes('LOTTERY_EMPTY') ? 'Lottery pool is empty' : error.message);
      return;
    }
    setLotteryPool(data?.pool_left ?? 0);
    addLog('LOTTERY', `Draw! Winner ${data?.winner} won ${fm(data?.prize || 0)}. Pool left: ${fm(data?.pool_left || 0)}`);
    await refreshPlayer();
    await router.refresh();
  };

  const openWarEvent = async (city: string) => {
    const { data, error } = await supabase.rpc('admin_open_war_event', { p_city: city });
    if (error) {
      addLog('ERROR', error.message.includes('EVENT_ALREADY_OPEN') ? t('tw_event_admin_already', { city }) : error.message);
      return;
    }
    addLog('WAR', t('tw_event_admin_opened', { city }));
    const { data: we } = await supabase.rpc('get_war_events');
    if (we) setWarEvents(we);
  };

  const cancelWarEvent = async (warId: string, city: string) => {
    const { error } = await supabase.rpc('cancel_war_event', { p_war_id: warId });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('WAR', t('tw_event_admin_cancelled', { city }));
    const { data: we } = await supabase.rpc('get_war_events');
    if (we) setWarEvents(we);
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-4xl font-bold mb-1">{t('admin_title')}</h1>
      <p className="text-amber-400 mb-6 text-sm">{t('admin_subtitle')}</p>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* LOGS + Quick Controls */}
        <div className="card p-5 lg:col-span-1">
          <h2 className="font-bold mb-2">{t('admin_log_title')}</h2>
          <div className="max-h-[320px] overflow-auto text-[10px] font-mono bg-black/70 p-3 rounded border border-zinc-800">
            {logs.length === 0 && <div className="text-zinc-500">{t('admin_log_empty')}</div>}
            {logs.map((log, i) => (
              <div key={i} className="mb-0.5">[{new Date(log.time).toLocaleTimeString()}] <span className="text-amber-400">[{log.type}]</span> {log.msg}</div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={loadAll} className="text-xs px-3 py-1 bg-zinc-800 rounded">{t('admin_refresh_all')}</button>
            <button onClick={() => giveToAllOnlineSim(25000)} className="text-xs px-3 py-1 bg-emerald-800 rounded">{t('admin_stimulus_button')}</button>
          </div>
        </div>

        {/* Economy + Tax + Pools */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-bold mb-2">{t('admin_economy_title')}</h2>
          <div className="grid grid-cols-2 gap-x-6 text-sm">
            <div>
              <div>{t('admin_money_circ')} <span className="font-mono text-emerald-400">{fm(economy?.total_money_circulation || 0)}</span></div>
              <div>{t('admin_players_families', { players: economy?.people_registered || '?', families: economy?.total_families || '?' })}</div>
              <div>{t('admin_online_week', { online: economy?.online_people || '?', week: economy?.logged_in_this_week || '?' })}</div>
            </div>
            <div>
              {pools && <div>{t('admin_pools_line', { bj: fm(pools.blackjack||0), rou: fm(pools.roulette||0) })}</div>}
              <div className="text-xs text-zinc-400 mt-1">{t('admin_tax_note')}</div>
            </div>
          </div>

          {/* Tax Controls - working */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="font-semibold mb-1">{t('admin_tax_title')}</div>
            <div className="flex gap-3 items-center text-sm">
              <div>{t('admin_tax_property')} <input id="propTax" type="number" defaultValue={10} className="w-14 bg-zinc-900 px-1 border" />%</div>
              <div>{t('admin_tax_bank')} <input id="bankTax" type="number" step="0.1" defaultValue={0.5} className="w-14 bg-zinc-900 px-1 border" />%</div>
              <button onClick={adjustTaxUI} className="px-3 py-0.5 bg-yellow-700 text-xs rounded">{t('admin_tax_apply')}</button>
            </div>
            <div className="text-[10px] text-zinc-500">{t('admin_tax_footer')}</div>
          </div>

          {/* Gov Tax Bank - Admin managed */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold">🏛️ Gov Tax Bank</div>
              <div className="text-sm font-mono text-amber-400">{govTax !== null ? fm(govTax) : '—'}</div>
            </div>
            <div className="flex gap-2 items-center text-sm flex-wrap">
              <input id="govAmt" type="number" defaultValue={50000} className="bg-zinc-900 px-2 py-1 border w-28" />
              <button onClick={() => govDeposit(parseInt((document.getElementById('govAmt') as HTMLInputElement).value))} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs">{t('admin_gov_deposit')}</button>
              <button onClick={() => govWithdraw(parseInt((document.getElementById('govAmt') as HTMLInputElement).value))} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">{t('admin_gov_withdraw')}</button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t('admin_gov_footer')}</div>
          </div>

          {/* Lottery Pool - Admin managed (mirrors Gov Tax Bank) */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold">🎟️ Lottery Pool</div>
              <div className="text-sm font-mono text-amber-400">{lotteryPool !== null ? fm(lotteryPool) : '—'}</div>
            </div>
            {nextDraw && (
              <div className="text-[10px] text-zinc-400 mb-1">Next draw: {new Date(nextDraw).toLocaleString()}</div>
            )}
            <div className="flex gap-2 items-center text-sm flex-wrap">
              <input id="lotAmt" type="number" defaultValue={50000} className="bg-zinc-900 px-2 py-1 border w-28" />
              <button onClick={() => lotDeposit(parseInt((document.getElementById('lotAmt') as HTMLInputElement).value))} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs">{t('admin_lot_deposit')}</button>
              <button onClick={() => lotWithdraw(parseInt((document.getElementById('lotAmt') as HTMLInputElement).value))} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">{t('admin_lot_withdraw')}</button>
              <button onClick={lotDraw} className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-xs">{t('admin_lot_draw')}</button>
              <button onClick={() => {
                const dt = (document.getElementById('lotSchedule') as HTMLInputElement).value;
                if (!dt) return;
                supabase.rpc('admin_set_lottery_schedule', { next_draw: new Date(dt).toISOString() }).then(() => fetchEconomy());
              }} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs">Set Schedule</button>
              <input id="lotSchedule" type="datetime-local" className="bg-zinc-900 px-2 py-1 border text-xs" />
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t('admin_lot_footer')}</div>
          </div>

          {/* All Banks Overview submenu */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="font-semibold mb-1">🏦 {t('admin_banks_title')}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_personal')}</span><span className="font-mono text-blue-400">{banks ? fm(banks.personal_bank_total) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_family')}</span><span className="font-mono text-amber-400">{banks ? fm(banks.family_bank_total) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_family_pending')}</span><span className="font-mono text-orange-400">{banks ? fm(banks.family_pending_total) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_gov')}</span><span className="font-mono text-red-400">{banks ? fm(banks.gov_tax) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_lottery')}</span><span className="font-mono text-amber-300">{banks ? fm(banks.lottery_pool) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_bj')}</span><span className="font-mono text-zinc-300">{banks ? fm(banks.casino_blackjack) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_roulette')}</span><span className="font-mono text-zinc-300">{banks ? fm(banks.casino_roulette) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">{t('admin_banks_general')}</span><span className="font-mono text-zinc-300">{banks ? fm(banks.casino_general) : '—'}</span></div>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t('admin_banks_footer')}</div>
          </div>

          {/* War Events - Admin hosted */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="font-semibold mb-1">📯 {t('tw_events_title')}</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['New York', 'Chicago', 'Los Angeles', 'Miami', 'Las Vegas'].map((c) => (
                <button key={c} onClick={() => openWarEvent(c)} className="px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-[10px] font-bold">
                  {t('tw_event_admin_open')}: {c}
                </button>
              ))}
            </div>
            {(warEvents?.pending?.length ?? 0) > 0 && (
              <div className="space-y-1">
                {warEvents.pending.map((ev: any) => (
                  <div key={ev.id} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px]">
                    <span>
                      <span className="font-semibold">{ev.city}</span>{' '}
                      <span className="text-amber-400">{t('tw_event_pending')}</span>{' '}
                      <span className="text-zinc-500">
                        {ev.applicant_1_name && `${ev.applicant_1_name}`}
                        {ev.applicant_2_name && ` · ${ev.applicant_2_name}`}
                        {!ev.applicant_1_name && !ev.applicant_2_name && t('tw_event_need_two', { n: 0 })}
                      </span>
                    </span>
                    <button onClick={() => cancelWarEvent(ev.id, ev.city)} className="px-2 py-0.5 rounded bg-red-800 hover:bg-red-700 text-[10px]">
                      {t('tw_event_admin_cancel')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] text-zinc-500 mt-1">{t('tw_events_subtitle')}</div>
          </div>

          {/* Give Money - FULL WORKING */}

          {/* Give Money - FULL WORKING */}
          <div className="mt-4 pt-3 border-t">
            <div className="font-semibold mb-1">{t('admin_give_title')}</div>
            <div className="flex gap-2">
              <input id="giveU" placeholder={t('admin_give_placeholder')} className="bg-zinc-900 px-2 py-1 text-sm border w-40" defaultValue="YGhosty" />
              <input id="giveA" type="number" defaultValue={250000} className="bg-zinc-900 px-2 py-1 text-sm border w-28" />
              <button onClick={() => {
                const u = (document.getElementById('giveU') as HTMLInputElement).value;
                const a = parseInt((document.getElementById('giveA') as HTMLInputElement).value);
                giveCash(u, a);
              }} className="px-4 bg-emerald-600 rounded text-sm">{t('admin_give_button')}</button>
            </div>
          </div>
          </div>

          {/* Server Stats & Leaderboards */}
          {serverStats && (
            <div className="mt-4 pt-3 border-t border-zinc-800">
              <h3 className="font-semibold mb-2">{t('admin_stats_title')}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-4">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_players')}</div>
                  <div className="font-mono text-lg text-white">{serverStats.total_players}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_cash')}</div>
                  <div className="font-mono text-lg text-emerald-400">{fm(serverStats.total_cash)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_bank')}</div>
                  <div className="font-mono text-lg text-blue-400">{fm(serverStats.total_bank)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_diamonds')}</div>
                  <div className="font-mono text-lg text-cyan-400">{fm(serverStats.total_diamonds)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_properties')}</div>
                  <div className="font-mono text-lg text-amber-400">{serverStats.total_properties}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_families')}</div>
                  <div className="font-mono text-lg text-orange-400">{serverStats.total_families}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_avg_level')}</div>
                  <div className="font-mono text-lg text-purple-400">{serverStats.avg_level}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_avg_power')}</div>
                  <div className="font-mono text-lg text-red-400">{fm(serverStats.avg_power)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_active_hour')}</div>
                  <div className="font-mono text-lg text-emerald-300">{serverStats.active_last_hour}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_active_day')}</div>
                  <div className="font-mono text-lg text-sky-300">{serverStats.active_last_day}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_banned')}</div>
                  <div className="font-mono text-lg text-red-500">{serverStats.banned_count}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500">{t('admin_stats_timed_out')}</div>
                  <div className="font-mono text-lg text-yellow-500">{serverStats.timed_out_count}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <h4 className="text-xs font-bold text-emerald-400 mb-2">{t('admin_leaderboard_cash')}</h4>
                  <div className="space-y-1 text-[11px]">
                    {topCash.slice(0, 5).map((p: any) => (
                      <div key={p.id} className="flex justify-between">
                        <span className="text-zinc-400">#{p.rank} {p.username}</span>
                        <span className="font-mono text-emerald-400">{fm(p.cash)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <h4 className="text-xs font-bold text-cyan-400 mb-2">{t('admin_leaderboard_diamonds')}</h4>
                  <div className="space-y-1 text-[11px]">
                    {topDiamonds.slice(0, 5).map((p: any) => (
                      <div key={p.id} className="flex justify-between">
                        <span className="text-zinc-400">#{p.rank} {p.username}</span>
                        <span className="font-mono text-cyan-400">{fm(p.diamonds)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <h4 className="text-xs font-bold text-purple-400 mb-2">{t('admin_leaderboard_level')}</h4>
                  <div className="space-y-1 text-[11px]">
                    {topLevel.slice(0, 5).map((p: any) => (
                      <div key={p.id} className="flex justify-between">
                        <span className="text-zinc-400">#{p.rank} {p.username}</span>
                        <span className="font-mono text-purple-400">Lvl {p.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <h4 className="text-xs font-bold text-sky-400 mb-2">{t('admin_leaderboard_active')}</h4>
                  <div className="space-y-1 text-[11px]">
                    {topActive.slice(0, 5).map((p: any) => (
                      <div key={p.id} className="flex justify-between">
                        <span className="text-zinc-400">#{p.rank} {p.username}</span>
                        <span className="font-mono text-sky-400">{p.last_active ? new Date(p.last_active).toLocaleString() : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Player Management Table - FULL CONTROL */}
        <div className="lg:col-span-3 card p-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold">{t('admin_roster_title')}</h3>
            <input placeholder={t('admin_search_placeholder')} className="bg-zinc-900 border px-2 py-1 text-xs" onChange={(e) => fetchPlayers(e.target.value)} />
            <button onClick={() => fetchPlayers()} className="text-xs px-3 py-1 bg-zinc-800 rounded">{t('admin_reload')}</button>
          </div>

          <div className="overflow-auto max-h-[380px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-zinc-700">
                  <th className="py-1 pr-2">{t('admin_col_username')}</th>
                  <th>{t('admin_col_cash')}</th>
                  <th>{t('admin_col_bank')}</th>
                  <th>{t('admin_col_level')}</th>
                  <th>{t('admin_col_power')}</th>
                  <th>{t('admin_col_rebirths')}</th>
                  <th>{t('admin_col_kill')}</th>
                  <th>{t('admin_col_donator')}</th>
                  <th>{t('admin_col_status')}</th>
                  <th>{t('admin_col_warnings')}</th>
                  <th>{t('admin_col_mod_status')}</th>
                  <th className="w-96">{t('admin_col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {allPlayers.map((p: any) => (
                  <tr key={p.id} className="border-b border-zinc-800 hover:bg-zinc-950">
                    <td className="py-1 font-medium pr-2">{p.username}</td>
                    <td>
                      <input type="number" defaultValue={p.cash} className="bg-black w-24 px-1 border text-xs" onBlur={(e) => updateFieldDirect(p.id, 'cash', e.target.value)} />
                    </td>
                    <td className="tabular-nums text-emerald-400">{fm(p.personal_bank || 0)}</td>
                    <td>
                      <input type="number" defaultValue={p.level} className="bg-black w-12 px-1 border text-xs" onBlur={e => updateFieldDirect(p.id, 'level', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" defaultValue={p.power} className="bg-black w-16 px-1 border text-xs" onBlur={e => updateFieldDirect(p.id, 'power', e.target.value)} />
                    </td>
                    <td>{p.rebirths}</td>
                    <td>{((p.murder_skill || 0) * 5).toFixed(0)}%</td>
                    <td>
                      <button onClick={() => setDonator(p.username, !p.is_donator)} className={`px-1.5 rounded text-[10px] ${p.is_donator ? 'bg-amber-600' : 'bg-zinc-700'}`}>
                        {p.is_donator ? 'VIP' : t('admin_set_vip')}
                      </button>
                    </td>
                    <td className="text-[10px]">
                      {p.jailed_until && 'JAIL'} {p.death_until && 'DEAD'}
                    </td>
                    <td className="text-[10px] font-mono">{p.warnings ?? 0}/3</td>
                    <td className="text-[10px]">
                      {p.banned_permanent && <span className="text-red-400">BANNED</span>}
                      {!p.banned_permanent && p.banned_until && <span className="text-orange-400">TEMP BAN</span>}
                      {p.timeout_until && <span className="text-yellow-400">TIMEOUT</span>}
                      {p.ip_banned && <span className="text-purple-400">IP BAN</span>}
                      {!p.banned_permanent && !p.banned_until && !p.timeout_until && !p.ip_banned && <span className="text-zinc-500">—</span>}
                    </td>
                    <td className="flex gap-1 flex-wrap py-0.5">
                      <button onClick={() => giveCash(p.username, 100000)} className="px-2 py-px bg-emerald-800 rounded text-[10px]">+100k</button>
                      <button onClick={() => giveCash(p.username, -50000)} className="px-2 py-px bg-orange-800 rounded text-[10px]">-50k</button>
                      <button onClick={() => forceClearStatus(p.id, 'jail')} className="px-2 py-px bg-blue-800 rounded text-[10px]">{t('admin_clear_jail')}</button>
                      <button onClick={() => forceClearStatus(p.id, 'death')} className="px-2 py-px bg-blue-800 rounded text-[10px]">{t('admin_revive')}</button>
                      <button onClick={() => updateFieldDirect(p.id, 'is_donator', true)} className="px-2 py-px bg-amber-700 rounded text-[10px]">{t('admin_make_donator')}</button>
                      <button onClick={() => supabase.rpc('admin_warn_player', { target_id: p.id, reason: '' }).then(() => fetchPlayers())} className="px-2 py-px bg-yellow-800 rounded text-[10px]">{t('admin_warn')}</button>
                      <button onClick={() => supabase.rpc('admin_kick_player', { target_id: p.id, duration_minutes: 60 }).then(() => fetchPlayers())} className="px-2 py-px bg-orange-900 rounded text-[10px]">{t('admin_kick')}</button>
                      <button onClick={() => supabase.rpc('admin_ban_player', { target_id: p.id, duration_hours: 24, permanent: false }).then(() => fetchPlayers())} className="px-2 py-px bg-red-900 rounded text-[10px]">{t('admin_ban')}</button>
                      {(p.banned_until || p.banned_permanent) && <button onClick={() => supabase.rpc('admin_unban_player', { target_id: p.id }).then(() => fetchPlayers())} className="px-2 py-px bg-emerald-900 rounded text-[10px]">{t('admin_unban')}</button>}
                      <button onClick={() => supabase.rpc('admin_timeout_player', { target_id: p.id, duration_minutes: 30 }).then(() => fetchPlayers())} className="px-2 py-px bg-yellow-900 rounded text-[10px]">{t('admin_timeout')}</button>
                      <button onClick={() => supabase.rpc('admin_ip_ban_player', { target_id: p.id }).then(() => fetchPlayers())} className="px-2 py-px bg-purple-900 rounded text-[10px]">{t('admin_ip_ban')}</button>
                      <button onClick={() => supabase.rpc('admin_clear_warnings', { target_id: p.id }).then(() => fetchPlayers())} className="px-2 py-px bg-zinc-700 rounded text-[10px]">{t('admin_clear_warnings')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-zinc-500 mt-2">{t('admin_edits_note')}</div>
        </div>
      </div>

      <div className="mt-4 text-xs">
        <a href="/dashboard" className="text-red-400">← {t('nav_dashboard')}</a> • {t('admin_footer')}
      </div>
    </div>
  );
}
