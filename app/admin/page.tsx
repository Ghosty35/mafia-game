'use client';

import { usePlayer } from '../components/PlayerContext';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type AdminPlayer = {
  id: string;
  username: string;
  cash: number;
  diamonds: number;
  level: number;
  power: number;
  rebirths: number;
  murder_skill: number;
  is_donator: boolean;
  staff_role: string | null;
  jailed_until: string | null;
  death_until: string | null;
  warnings: number;
  banned_permanent: boolean;
  banned_until: string | null;
  timeout_until: string | null;
  ip_banned: boolean;
  personal_bank: number;
  weed_progress?: number;
  bullets?: number;
  rank?: number;
  last_active?: string;
} & Record<string, unknown>;

type AdminProperty = {
  id: string;
  name: string;
  city: string;
  type: string;
  income: number;
} & Record<string, unknown>;

type AdminWarEvent = {
  id: string;
  city: string;
  applicant_1_name: string | null;
  applicant_2_name: string | null;
} & Record<string, unknown>;

type AdminStaff = {
  username: string;
  level: number;
  staff_role: string | null;
} & Record<string, unknown>;

type AdminConfig = {
  key: string;
  label: string;
  num: number;
} & Record<string, unknown>;

type EconomyData = {
  total_money_circulation: number;
  people_registered: number;
  total_families: number;
  online_people: number;
  logged_in_this_week: number;
} & Record<string, unknown>;

type CasinoPools = {
  blackjack: number;
  roulette: number;
} & Record<string, unknown>;

type BanksOverview = {
  personal_bank_total: number;
  family_bank_total: number;
  family_pending_total: number;
  gov_tax: number;
  lottery_pool: number;
  casino_blackjack: number;
  casino_roulette: number;
  casino_general: number;
};

type ServerStats = {
  total_players: number;
  total_cash: number;
  total_bank: number;
  total_diamonds: number;
  total_properties: number;
  total_families: number;
  avg_level: number;
  avg_power: number;
  active_last_hour: number;
  active_last_day: number;
  banned_count: number;
  timed_out_count: number;
} & Record<string, unknown>;

export default function AdminPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [logs, setLogs] = useState<Array<{ time: string; type: string; msg: string }>>([]);
  const [allPlayers, setAllPlayers] = useState<AdminPlayer[]>([]);
  const [economy, setEconomy] = useState<EconomyData | null>(null);
  const [pools, setPools] = useState<CasinoPools | null>(null);
  const [govTax, setGovTax] = useState<number | null>(null);
  const [lotteryPool, setLotteryPool] = useState<number | null>(null);
  const [banks, setBanks] = useState<BanksOverview | null>(null);
  const [warEvents, setWarEvents] = useState<{ pending: AdminWarEvent[] } | null>(null);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [topCash, setTopCash] = useState<AdminPlayer[]>([]);
  const [topDiamonds, setTopDiamonds] = useState<AdminPlayer[]>([]);
  const [topLevel, setTopLevel] = useState<AdminPlayer[]>([]);
  const [topActive, setTopActive] = useState<AdminPlayer[]>([]);
  const [nextDraw, setNextDraw] = useState<string | null>(null);
  const [propTarget, setPropTarget] = useState('');
  const [propList, setPropList] = useState<AdminProperty[]>([]);
  const [propLoading, setPropLoading] = useState(false);
  const [staffTarget, setStaffTarget] = useState('');
  const [staffList, setStaffList] = useState<AdminStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [config, setConfig] = useState<AdminConfig[]>([]);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [newCfgKey, setNewCfgKey] = useState('');
  const [newCfgVal, setNewCfgVal] = useState('');
  const isCEO = (player as { staff_role?: string })?.staff_role === 'ceo';
  // Any staff role can open the admin panel; the server gates each action via
  // is_admin(). CEO-only sections (staff management) use isCEO. No username hardcode.
  const isAdmin = !!player;

  const supabase = createClient();

  const addLog = (type: string, msg: string) => {
    const entry = { time: new Date().toISOString(), type, msg };
    setLogs(prev => [entry, ...prev].slice(0, 80));
  };

  const inspectPlayerProperties = async () => {
    if (!propTarget.trim()) return;
    setPropLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_player_properties', { p_target_username: propTarget.trim() });
      if (error) {
        addLog('ERROR', error.message);
        setPropList([]);
      } else if (data) {
        const props = data as unknown as { properties?: AdminProperty[]; username?: string; property_count?: number };
        setPropList(props.properties || []);
        addLog('PROP', `Inspected ${props.username ?? ''}: ${props.property_count ?? 0} properties`);
      }
    } finally {
      setPropLoading(false);
    }
  };

  const giveProperty = async (propJson: string) => {
    if (!propTarget.trim() || !propJson.trim()) return;
    try {
      const prop = JSON.parse(propJson);
      const { data, error } = await supabase.rpc('admin_give_property', {
        p_target_username: propTarget.trim(),
        p_property: prop,
      });
      if (error) {
        addLog('ERROR', error.message);
        return;
      }
      addLog('PROP', `Gave ${prop.name || prop.id} to ${data?.username || propTarget}`);
      inspectPlayerProperties();
    } catch {
      addLog('ERROR', 'Invalid property JSON');
    }
  };

  const sellProperty = async (propId: string) => {
    if (!propTarget.trim() || !propId) return;
    const { data, error } = await supabase.rpc('admin_sell_property', {
      p_target_username: propTarget.trim(),
      p_prop_id: propId,
    });
    if (error) {
      addLog('ERROR', error.message);
      return;
    }
    addLog('PROP', `Removed ${data?.removed_name || propId} from ${data?.username || propTarget}`);
    inspectPlayerProperties();
  };

  const loadStaff = async () => {
    setStaffLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_staff');
      if (!error && data) setStaffList((data as unknown as { staff?: AdminStaff[] }).staff || []);
    } finally {
      setStaffLoading(false);
    }
  };

  const setStaffRole = async (username: string, role: string | null) => {
    const { error } = await supabase.rpc('admin_set_staff_role', {
      p_target_username: username,
      p_staff_role: role,
    });
    if (error) {
      addLog('ERROR', error.message);
      return;
    }
    addLog('STAFF', `Set ${username} role to ${role || 'none'}`);
    loadStaff();
    fetchPlayers();
  };

  const loadConfig = async () => {
    const { data, error } = await supabase.rpc('admin_get_config');
    if (!error && data) setConfig(data as AdminConfig[]);
  };

  const saveConfig = async (key: string, value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) { addLog('ERROR', `Invalid number for ${key}`); return; }
    const { error } = await supabase.rpc('admin_set_config', { p_key: key, p_value: num });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('CONFIG', `Set ${key} = ${num}`);
    loadConfig();
  };

  const fetchPlayers = async (search?: string) => {
    const { data, error } = await supabase.rpc('admin_list_players', { search: search || null });
    if (!error && data) setAllPlayers(data as AdminPlayer[]);
  };

  const fetchEconomy = async () => {
    try {
      const { data: stats } = await supabase.rpc('get_server_stats');
      setEconomy(stats as unknown as EconomyData | null);

      const { data: cp } = await supabase.rpc('get_casino_pools');
      setPools(cp as unknown as CasinoPools | null);

      const { data: gt } = await supabase.rpc('admin_get_gov_tax');
      if (gt) setGovTax((gt as unknown as { balance?: number }).balance ?? 0);

      const { data: lot } = await supabase.rpc('admin_get_lottery');
      if (lot) setLotteryPool((lot as unknown as { pool?: number }).pool ?? 0);

      const { data: bk } = await supabase.rpc('admin_banks_overview');
      if (bk) setBanks(bk as unknown as BanksOverview);

      const { data: we } = await supabase.rpc('get_war_events');
      if (we) setWarEvents(we as unknown as { pending: AdminWarEvent[] });

      const { data: ss } = await supabase.rpc('admin_get_server_stats');
      if (ss) setServerStats(ss as unknown as ServerStats);

      const { data: nd } = await supabase.rpc('admin_get_lottery');
      if (nd) setNextDraw((nd as unknown as { next_draw?: string }).next_draw || null);

      const { data: tc } = await supabase.rpc('admin_get_top_cash', { limit_count: 10 });
      if (tc) setTopCash(tc as AdminPlayer[]);

      const { data: td } = await supabase.rpc('admin_get_top_diamonds', { limit_count: 10 });
      if (td) setTopDiamonds(td as AdminPlayer[]);

      const { data: tl } = await supabase.rpc('admin_get_top_level', { limit_count: 10 });
      if (tl) setTopLevel(tl as AdminPlayer[]);

      const { data: ta } = await supabase.rpc('admin_get_top_active', { limit_count: 10 });
      if (ta) setTopActive(ta as AdminPlayer[]);
    } catch {
      // ignore
    }
  };

  const loadAll = () => {
    if (!isAdmin) return;
    fetchPlayers();
    fetchEconomy();
    loadConfig();
    if (isCEO) loadStaff();
    addLog('INFO', 'Admin data refreshed');
  };

   useEffect(() => {
     if (isAdmin) {
       loadAll();
     }
   }, [isAdmin, loadAll]);

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

  const updateFieldDirect = async (pid: string, field: string, value: unknown) => {
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
    // Real, live: property tax % is persisted to game_config and read by
    // purchase_property via _cfg('property_tax_pct'). Applies to all players at once.
    const prop = parseFloat((document.getElementById('propTax') as HTMLInputElement)?.value || '10');
    if (!Number.isFinite(prop) || prop < 0 || prop > 90) { addLog('ERROR', 'Property tax must be 0–90%'); return; }
    const { error } = await supabase.rpc('admin_set_config', { p_key: 'property_tax_pct', p_value: prop });
    if (error) { addLog('ERROR', error.message); return; }
    addLog('TAX', `Property purchase tax set to ${prop}% (live for all players)`);
    loadConfig();
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
    const { error } = await supabase.rpc('admin_open_war_event', { p_city: city });
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
              <Link href="/reputations/tax-bank" className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs">{t('menu_tax_bank')} →</Link>
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
              <Link href="/casino/lottery" className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs">Lottery Page →</Link>
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
                {warEvents?.pending?.map((ev: AdminWarEvent) => (
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
          <div className="mt-4 pt-3 border-t">
            <div className="font-semibold mb-1">{t('admin_give_title')}</div>
            <div className="flex gap-2">
              <input id="giveU" placeholder={t('admin_give_placeholder')} className="bg-zinc-900 px-2 py-1 text-sm border w-40" defaultValue="" />
              <input id="giveA" type="number" defaultValue={250000} className="bg-zinc-900 px-2 py-1 text-sm border w-28" />
              <button onClick={() => {
                const u = (document.getElementById('giveU') as HTMLInputElement).value;
                const a = parseInt((document.getElementById('giveA') as HTMLInputElement).value);
                giveCash(u, a);
              }} className="px-4 bg-emerald-600 rounded text-sm">{t('admin_give_button')}</button>
            </div>
          </div>

          {/* Property Management - Admin gives / sells any property */}
          <div className="mt-4 pt-3 border-t">
            <div className="font-semibold mb-1">🏠 Property Management</div>
            <div className="flex gap-2 mb-2">
              <input id="propTarget" placeholder="Target username" className="bg-zinc-900 px-2 py-1 text-sm border w-40" value={propTarget} onChange={e => setPropTarget(e.target.value)} />
              <button onClick={inspectPlayerProperties} disabled={propLoading} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs">{propLoading ? 'Loading...' : 'Inspect Properties'}</button>
            </div>

            {propList.length > 0 && (
              <div className="space-y-1 mb-3 max-h-[200px] overflow-auto">
                {propList.map((prop: AdminProperty, i: number) => (
                  <div key={prop.id || i} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px]">
                    <div className="truncate pr-2">
                      <span className="font-semibold">{prop.name || prop.id}</span>
                      <span className="text-zinc-400 ml-1">{prop.city} • {prop.type}</span>
                      {prop.income && <span className="text-emerald-400 ml-1">${prop.income}/h</span>}
                    </div>
                    <button onClick={() => sellProperty(prop.id)} className="px-2 py-0.5 bg-red-800 hover:bg-red-700 rounded text-[10px] shrink-0">Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-start">
              <textarea id="propJson" placeholder='{"id":"house1","name":"GhostHouse","city":"New York","type":"residential"}' className="bg-zinc-900 px-2 py-1 text-xs border w-96 h-16 font-mono" />
              <button onClick={() => {
                const json = (document.getElementById('propJson') as HTMLInputElement).value;
                giveProperty(json);
              }} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs shrink-0">Give Property</button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">Paste a JSON property object. Admin only — bypasses all purchase checks.</div>
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
                    {topCash.slice(0, 5).map((p: AdminPlayer) => (
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
                    {topDiamonds.slice(0, 5).map((p: AdminPlayer) => (
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
                    {topLevel.slice(0, 5).map((p: AdminPlayer) => (
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
                    {topActive.slice(0, 5).map((p: AdminPlayer) => (
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
                  <th className="text-[10px]">Staff Role</th>
                  <th>{t('admin_col_status')}</th>
                  <th>{t('admin_col_warnings')}</th>
                  <th>{t('admin_col_mod_status')}</th>
                  <th className="w-96">{t('admin_col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {allPlayers.map((p: AdminPlayer) => (
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
                      {isCEO ? (
                        <select
                          value={p.staff_role || ''}
                          onChange={(e) => setStaffRole(p.username, e.target.value || null)}
                          className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px]"
                        >
                          <option value="">—</option>
                          <option value="admin">Admin</option>
                          <option value="jr_admin">Jr-Admin</option>
                          <option value="game_mod">Game-Mod</option>
                          <option value="support">Support</option>
                        </select>
                      ) : (
                        <span className="text-zinc-400">{p.staff_role || '—'}</span>
                      )}
                    </td>
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

        {/* Staff Management - CEO only */}
        {isCEO && (
          <div className="lg:col-span-3 card p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold">🛡️ Staff Management</h3>
              <button onClick={loadStaff} disabled={staffLoading} className="text-xs px-3 py-1 bg-zinc-800 rounded">Refresh</button>
            </div>
            <div className="text-[10px] text-zinc-400 mb-3">Manage your admin team. Only CEO can assign roles.</div>

            <div className="space-y-1 mb-4 max-h-[200px] overflow-auto">
              {staffList.length === 0 && <div className="text-zinc-500 text-xs">No staff members assigned yet.</div>}
               {staffList.map((s: AdminStaff) => (
                <div key={s.username} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px]">
                  <div className="truncate pr-2">
                    <span className="font-semibold">{s.username}</span>
                    <span className="text-zinc-400 ml-1">Lvl {s.level}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <span className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 text-[10px] font-bold uppercase">{s.staff_role || 'none'}</span>
                    {s.staff_role !== 'ceo' && (
                      <button onClick={() => setStaffRole(s.username, null)} className="px-1.5 py-0.5 bg-red-900 hover:bg-red-800 rounded text-[10px]">Remove</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800 pt-3">
              <div className="font-semibold mb-2 text-xs">Promote / Assign Role</div>
              <div className="flex gap-2 mb-2">
                <input
                  placeholder="Username"
                  className="bg-zinc-900 border px-2 py-1 text-xs w-32"
                  value={staffTarget}
                  onChange={e => setStaffTarget(e.target.value)}
                />
                <select
                  className="bg-zinc-900 border px-2 py-1 text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const username = staffTarget.trim();
                    if (!username) return;
                    const role = e.target.value || null;
                    setStaffRole(username, role);
                    setStaffTarget('');
                    e.target.value = '';
                  }}
                >
                  <option value="">Select role...</option>
                  <option value="admin">Admin</option>
                  <option value="jr_admin">Jr-Admin</option>
                  <option value="game_mod">Game-Modder</option>
                  <option value="support">Customer Support</option>
                </select>
              </div>
              <div className="text-[10px] text-zinc-500">Roles: Admin → Jr-Admin → Game-Modder → Customer Support. CEO can remove any role.</div>
            </div>
          </div>
        )}

        {/* Live Economy Config — tune balance knobs without a redeploy */}
        <div className="lg:col-span-3 card p-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold">⚙️ Live Economy Config</h3>
            <button onClick={loadConfig} className="text-xs px-3 py-1 bg-zinc-800 rounded">Refresh</button>
          </div>
          <div className="text-[10px] text-zinc-400 mb-3">
            Change a value and hit Save — it applies to all players instantly, no deploy. Unset keys fall back to the code default.
          </div>
          <div className="space-y-1 mb-4 max-h-[260px] overflow-auto">
            {config.length === 0 && <div className="text-zinc-500 text-xs">No config knobs yet.</div>}
            {config.map((c: AdminConfig) => (
              <div key={c.key} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px] gap-2">
                <div className="truncate pr-2 min-w-0">
                  <span className="font-mono font-semibold">{c.key}</span>
                  {c.label && <span className="text-zinc-500 ml-2">{c.label}</span>}
                </div>
                <div className="flex gap-1 shrink-0 items-center">
                  <input
                    type="number"
                    className="bg-zinc-900 border px-2 py-1 text-xs w-28 text-right"
                    defaultValue={c.num}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  />
                  <button
                    onClick={() => saveConfig(c.key, configDraft[c.key] ?? String(c.num))}
                    className="px-2 py-1 bg-emerald-800 hover:bg-emerald-700 rounded text-[10px]"
                  >Save</button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-800 pt-3">
            <div className="font-semibold mb-2 text-xs">Add / override a knob</div>
            <div className="flex gap-2">
              <input
                placeholder="key (e.g. bullet_cap)"
                className="bg-zinc-900 border px-2 py-1 text-xs flex-1 font-mono"
                value={newCfgKey}
                onChange={(e) => setNewCfgKey(e.target.value)}
              />
              <input
                type="number"
                placeholder="value"
                className="bg-zinc-900 border px-2 py-1 text-xs w-28 text-right"
                value={newCfgVal}
                onChange={(e) => setNewCfgVal(e.target.value)}
              />
              <button
                onClick={() => { if (newCfgKey.trim()) { saveConfig(newCfgKey.trim(), newCfgVal); setNewCfgKey(''); setNewCfgVal(''); } }}
                className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs"
              >Set</button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-2">Only keys the code reads via <span className="font-mono">_cfg()</span> take effect. Current wired keys: bullet_cap, bullet_bust_threshold, family_hourly_cap.</div>
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs">
        <a href="/dashboard" className="text-red-400">← {t('nav_dashboard')}</a> • {t('admin_footer')}
      </div>
    </div>
  );
}
