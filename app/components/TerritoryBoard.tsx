'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from './PlayerContext';
import { formatCash } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n/translations';

type ActiveWarSummary = {
  id: string;
  attacker_name: string;
  defender_name: string;
  attacker_score: number;
  defender_score: number;
  ends_at: string;
};

type Territory = {
  city: string;
  owner_family_id: string | null;
  owner_family_name: string | null;
  power_invested: number;
  claimed_at: string | null;
  income_per_hour: number;
  protected_until: string | null;
  active_war: ActiveWarSummary | null;
};

type Contributor = { username: string; points: number; family_id: string };

type War = {
  id: string;
  city: string;
  attacker_family_id: string;
  defender_family_id: string;
  attacker_name: string;
  defender_name: string;
  attacker_score: number;
  defender_score: number;
  state: 'active' | 'attacker_won' | 'defender_won';
  loot: number;
  started_at: string;
  ends_at: string;
  resolved_at: string | null;
  my_side?: 'attacker' | 'defender' | null;
  my_points?: number | null;
  my_next_attack_at?: string | null;
  top_contributors?: Contributor[];
};

// Map the RPC exception tokens to translated messages; unknown errors
// fall through raw so QA can see them.
const ERROR_KEYS: Record<string, TranslationKey> = {
  NOT_IN_FAMILY: 'tw_err_not_in_family',
  NOT_AUTHORIZED: 'tw_err_not_authorized',
  NOT_ENOUGH_FAMILY_POWER: 'tw_err_no_power',
  CITY_PROTECTED: 'tw_err_protected',
  FAMILY_AT_WAR: 'tw_err_at_war',
  CITY_OWNED_DECLARE_WAR: 'tw_err_owned',
  CITY_UNCLAIMED_USE_CLAIM: 'tw_err_unclaimed',
  ON_COOLDOWN: 'tw_err_cooldown',
  NOT_ENOUGH_BULLETS: 'tw_err_no_bullets',
  WAR_OVER: 'tw_err_war_over',
  NOT_YOUR_WAR: 'tw_err_not_your_war',
  IN_JAIL: 'tw_err_jailed',
  DEAD: 'tw_err_dead',
};

function fmtCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function TerritoryBoard() {
  const { language, t } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [activeWars, setActiveWars] = useState<War[]>([]);
  const [recentWars, setRecentWars] = useState<War[]>([]);
  const [myFamilyId, setMyFamilyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulletsByWar, setBulletsByWar] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const supabase = createClient();
  const isHigherup = myRole === 'boss' || myRole === 'underboss';

  const load = async () => {
    // No unmount guard (dev StrictMode double-mount, see MostWantedBoard).
    const [terrRes, warsRes, famRes] = await Promise.all([
      supabase.rpc('get_territories'),
      supabase.rpc('get_family_wars'),
      supabase.rpc('get_my_family'),
    ]);
    if (terrRes.data) setTerritories(terrRes.data as Territory[]);
    if (warsRes.data) {
      setActiveWars((warsRes.data.active ?? []) as War[]);
      setRecentWars((warsRes.data.recent ?? []) as War[]);
      setMyFamilyId((warsRes.data.my_family_id ?? null) as string | null);
    }
    if (famRes.data) setMyRole((famRes.data.my_role ?? null) as string | null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateError = (message: string): string => {
    for (const token of Object.keys(ERROR_KEYS)) {
      if (message.includes(token)) return t(ERROR_KEYS[token]);
    }
    return message;
  };

  const runAction = async (fn: () => PromiseLike<{ error: { message: string } | null }>, okMsg?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await fn();
    if (err) setError(translateError(err.message));
    else if (okMsg) setNotice(okMsg);
    await load();
    if (refreshPlayer) await refreshPlayer();
    setBusy(false);
  };

  const claim = (city: string) =>
    runAction(() => supabase.rpc('claim_territory', { p_city: city }), t('tw_claimed_ok', { city }));

  const declareWar = (city: string) =>
    runAction(() => supabase.rpc('declare_war', { p_city: city }), t('tw_declared_ok', { city }));

  const attack = (warId: string) => {
    const bullets = Math.max(0, Math.min(100, parseInt(bulletsByWar[warId] || '0', 10) || 0));
    return runAction(() => supabase.rpc('war_attack', { p_war_id: warId, p_bullets: bullets }));
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500 text-sm">{t('tw_loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}
      {notice && (
        <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-lg px-3 py-2">{notice}</div>
      )}

      {/* ---- active wars ---- */}
      {activeWars.map((w) => {
        const total = w.attacker_score + w.defender_score;
        const attackerPct = total > 0 ? Math.round((w.attacker_score / total) * 100) : 50;
        const mine = w.my_side != null;
        const cdMs = w.my_next_attack_at ? new Date(w.my_next_attack_at).getTime() - now : 0;
        const onCooldown = cdMs > 0;
        return (
          <div key={w.id} className="bg-zinc-900 border border-red-900/60 rounded-xl overflow-hidden text-sm">
            <div className="bg-gradient-to-r from-red-950 to-zinc-900 px-4 py-2 flex items-center justify-between">
              <h3 className="font-bold tracking-tight">
                ⚔️ {t('tw_war_over_city', { city: w.city })}
              </h3>
              <span className="font-mono text-xs text-orange-400 tabular-nums">
                ⏳ {fmtCountdown(new Date(w.ends_at).getTime() - now)}
              </span>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className={w.my_side === 'attacker' ? 'text-emerald-400' : 'text-zinc-200'}>
                  {w.attacker_name} · {w.attacker_score}
                </span>
                <span className={w.my_side === 'defender' ? 'text-emerald-400' : 'text-zinc-200'}>
                  {w.defender_score} · {w.defender_name}
                </span>
              </div>
              <div className="h-2 rounded bg-blue-900/70 overflow-hidden">
                <div className="h-full bg-red-600 transition-all" style={{ width: `${attackerPct}%` }} />
              </div>

              {mine && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="text-xs text-zinc-400">
                    {t('tw_bullets_label', { owned: player?.bullets ?? 0 })}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={bulletsByWar[w.id] ?? '0'}
                    onChange={(e) => setBulletsByWar((prev) => ({ ...prev, [w.id]: e.target.value }))}
                    className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => attack(w.id)}
                    disabled={busy || onCooldown}
                    className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold"
                  >
                    {onCooldown ? `${t('tw_attack_cooldown')} ${fmtCountdown(cdMs)}` : `⚔️ ${t('tw_attack')}`}
                  </button>
                  {w.my_points != null && (
                    <span className="text-xs text-zinc-400">
                      {t('tw_my_points')}: <span className="text-emerald-400 font-mono">{w.my_points}</span>
                    </span>
                  )}
                </div>
              )}

              {(w.top_contributors?.length ?? 0) > 0 && (
                <div className="text-[10px] text-zinc-500 pt-1">
                  {t('tw_top_fighters')}:{' '}
                  {w.top_contributors!.map((c, i) => (
                    <span key={c.username}>
                      {i > 0 && ' · '}
                      <span className={c.family_id === myFamilyId ? 'text-emerald-400' : 'text-zinc-300'}>
                        {c.username}
                      </span>{' '}
                      ({c.points})
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* ---- territory table ---- */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
        <div className="bg-gradient-to-r from-red-950 to-zinc-900 px-4 py-2 flex items-center justify-between">
          <h2 className="font-bold tracking-tight">🗺️ {t('tw_title')}</h2>
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{t('tw_subtitle')}</span>
        </div>

        <div className="grid grid-cols-12 bg-zinc-800 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-3">{t('tw_col_city')}</div>
          <div className="col-span-3">{t('tw_col_owner')}</div>
          <div className="col-span-2 text-right">{t('tw_col_income')}</div>
          <div className="col-span-4 text-right">{t('tw_col_action')}</div>
        </div>

        {territories.map((terr) => {
          const isMine = myFamilyId != null && terr.owner_family_id === myFamilyId;
          const protectedMs = terr.protected_until ? new Date(terr.protected_until).getTime() - now : 0;
          const isProtected = protectedMs > 0;
          return (
            <div key={terr.city} className="grid grid-cols-12 px-3 py-2 border-t border-zinc-800 items-center">
              <div className="col-span-3 font-medium">{terr.city}</div>
              <div className="col-span-3 truncate pr-2">
                {terr.owner_family_name ? (
                  <span className={isMine ? 'text-emerald-400 font-semibold' : 'text-zinc-200'}>
                    {terr.owner_family_name}
                  </span>
                ) : (
                  <span className="text-zinc-500 italic">{t('tw_unclaimed')}</span>
                )}
              </div>
              <div className="col-span-2 text-right font-mono text-emerald-400 tabular-nums text-xs">
                {formatCash(terr.income_per_hour ?? 0, language)}/{t('tw_hour_abbr')}
              </div>
              <div className="col-span-4 text-right">
                {terr.active_war ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-bold">
                    ⚔️ {t('tw_at_war')}
                  </span>
                ) : isProtected ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 font-mono">
                    🛡️ {fmtCountdown(protectedMs)}
                  </span>
                ) : isMine ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/70 text-emerald-300 font-bold">
                    ✓ {t('tw_yours')}
                  </span>
                ) : terr.owner_family_id == null ? (
                  isHigherup ? (
                    <button
                      onClick={() => claim(terr.city)}
                      disabled={busy}
                      className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-[10px] font-bold"
                    >
                      {t('tw_claim_btn')}
                    </button>
                  ) : (
                    <span className="text-[10px] text-zinc-500">{t('tw_boss_only')}</span>
                  )
                ) : isHigherup ? (
                  <button
                    onClick={() => declareWar(terr.city)}
                    disabled={busy}
                    className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 text-[10px] font-bold"
                  >
                    ⚔️ {t('tw_declare_btn')}
                  </button>
                ) : (
                  <span className="text-[10px] text-zinc-500">{t('tw_boss_only')}</span>
                )}
              </div>
            </div>
          );
        })}

        <p className="px-3 py-2 text-[10px] text-zinc-500 border-t border-zinc-800">
          {t('tw_rules_hint')}
        </p>
      </div>

      {/* ---- recent wars ---- */}
      {recentWars.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
          <div className="bg-zinc-800/80 px-4 py-2">
            <h2 className="font-bold tracking-tight text-xs uppercase text-zinc-400">📜 {t('tw_recent_wars')}</h2>
          </div>
          {recentWars.map((w) => {
            const attackerWon = w.state === 'attacker_won';
            const winner = attackerWon ? w.attacker_name : w.defender_name;
            const loser = attackerWon ? w.defender_name : w.attacker_name;
            return (
              <div key={w.id} className="px-4 py-2 border-t border-zinc-800 text-xs flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="text-emerald-400 font-semibold">{winner}</span>{' '}
                  <span className="text-zinc-400">{t('tw_beat')}</span>{' '}
                  <span className="text-red-400">{loser}</span>{' '}
                  <span className="text-zinc-500">· {w.city}</span>
                  <span className="text-zinc-500 font-mono ml-1">
                    ({w.attacker_score}–{w.defender_score})
                  </span>
                </span>
                <span className="font-mono text-amber-400 shrink-0">
                  {w.loot > 0 ? `💰 ${formatCash(w.loot, language)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
