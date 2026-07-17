'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';

interface PostedRace {
  id: string;
  poster_id: string;
  poster_name: string;
  car_name: string;
  bet: number;
  entry_fee: number;
  status: 'open' | 'ready' | 'finished' | 'cancelled';
  joined_by: string | null;
  joined_name: string | null;
  winner_name: string | null;
  expire_at: string | null;
  created_at: string;
}

type RaceCar = {
  id: string;
  name: string;
  condition?: number;
};

const BET_PRESETS = [500, 2500, 10000, 50000];

export default function RacePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const [openRaces, setOpenRaces] = useState<PostedRace[]>([]);
  const [history, setHistory] = useState<PostedRace[]>([]);
  const [bet, setBet] = useState(500);
  const [expireMinutes, setExpireMinutes] = useState(60);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const cars: RaceCar[] = player?.cars || [];
  const validCars = cars.filter((c) => (c.condition || 100) >= 75);

  const supabase = createClient();

  const loadRaces = useCallback(async () => {
    const { data: open } = await supabase.rpc('get_open_races');
    setOpenRaces((open as PostedRace[]) || []);
    const { data: hist } = await supabase.rpc('get_race_history');
    setHistory((hist as PostedRace[]) || []);
  }, []);

  useEffect(() => {
    if (!player) return;
    loadRaces();
    const iv = setInterval(loadRaces, 10000); // keep the open-race board live
    return () => clearInterval(iv);
  }, [player?.id, loadRaces]);

  const postRace = async () => {
    if (!player || !selectedCarId || validCars.length === 0) {
      setMessage(t('race_select_valid'));
      return;
    }
    const car = cars.find((c) => c.id === selectedCarId);
    if (!car || (car.condition || 100) < 75) {
      setMessage(t('race_health_req'));
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('post_race', {
      car_name: car.name,
      bet,
      expire_minutes: expireMinutes,
    });
    setBusy(false);
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('race_entry_no_cash')
          : error.message || t('race_post_failed'),
      );
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    await loadRaces();
    setMessage(t('race_posted', { fee: fm(data?.entry_fee ?? 0), minutes: expireMinutes }));
  };

  const joinRace = async (race: PostedRace) => {
    if (!player) return;
    setBusy(true);
    const { error } = await supabase.rpc('join_race', { race_id: race.id });
    setBusy(false);
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('race_entry_no_cash')
          : error.message || t('race_join_failed'),
      );
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    await loadRaces();
    setMessage(t('race_joined', { poster: race.poster_name }));
  };

  const startRace = async (race: PostedRace) => {
    if (!player) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('run_race', { race_id: race.id });
    setBusy(false);
    if (error) {
      setMessage(error.message || t('race_settle_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    await loadRaces();
    setMessage(
      data?.you_won
        ? t('race_won', { opponent: (data?.winner === race.poster_name ? race.joined_name : race.poster_name) ?? '', pot: fm(data?.pot ?? 0) })
        : t('race_lost', { opponent: data?.winner ?? '', bet: fm(race.bet) }),
    );
  };

  const cancelRace = async (race: PostedRace) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('cancel_race', { race_id: race.id });
    setBusy(false);
    if (error) {
      setMessage(error.message || t('race_settle_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    await loadRaces();
    setMessage(t('race_canceled') + (data?.refunded ? ` (+${fm(data.refunded)})` : ''));
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🏁 {t('race_title')}</h1>
        <p className="text-xs text-zinc-400">{t('race_desc')}</p>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Post race */}
        <Panel title={t('race_post_title')} icon="🏎️" className="lg:col-span-2 self-start">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('race_select_car')}</label>
              <select
                value={selectedCarId}
                onChange={(e) => setSelectedCarId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">{t('race_select_car')}</option>
                {validCars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.condition || 100}%)
                  </option>
                ))}
              </select>
              {validCars.length === 0 && (
                <p className="text-[11px] text-amber-400 mt-1">
                  {t('race_no_valid_cars')}{' '}
                  <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('race_bet_label')}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {BET_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setBet(p)}
                    className={`px-2.5 py-1 rounded text-xs font-mono border ${bet === p ? 'bg-red-900/60 border-red-700 text-red-300' : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
                  >
                    {fm(p)}
                  </button>
                ))}
              </div>
              <input
                type="number"
                value={bet}
                min={100}
                onChange={(e) => setBet(parseInt(e.target.value) || 500)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('race_expiry_label')}</label>
              <select
                value={expireMinutes}
                onChange={(e) => setExpireMinutes(parseInt(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value={5}>{t('race_5min')}</option>
                <option value={15}>{t('race_15min')}</option>
                <option value={60}>{t('race_1hour')}</option>
                <option value={120}>{t('race_2hours')}</option>
              </select>
            </div>

            <button
              onClick={postRace}
              disabled={busy || !selectedCarId}
              className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              🏁 {t('race_post_button')}
            </button>
            <p className="text-[11px] text-zinc-500">{t('race_rules_note')}</p>
          </div>
        </Panel>

        {/* Open races */}
        <Panel title={t('race_open_title')} icon="🚦" className="lg:col-span-3 self-start" bodyClassName="p-0">
          {openRaces.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('race_none_open')}</div>
          ) : (
            openRaces.map((race) => {
              const minutesLeft = race.expire_at
                ? Math.max(0, Math.floor((new Date(race.expire_at).getTime() - Date.now()) / 60000))
                : 0;
              const mine = race.poster_id === player?.id;
              const canStart = race.status === 'ready' && (mine || race.joined_by === player?.id);
              return (
                <div key={race.id} className={`border-t first:border-t-0 border-zinc-800 px-4 py-3 ${mine ? 'bg-red-950/20' : 'hover:bg-zinc-800/30'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">
                        {race.poster_name}
                        {mine && <span className="ml-2 text-[10px] px-1.5 py-px bg-red-900/60 text-red-300 rounded uppercase">{t('race_yours')}</span>}
                        {race.status === 'ready' && <span className="ml-2 text-[10px] px-1.5 py-px bg-emerald-900/60 text-emerald-300 rounded uppercase">{t('race_ready')}</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        🚗 {race.car_name}
                        {race.joined_name && <span className="ml-2">🆚 {race.joined_name}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('race_col_bet')}</div>
                      <div className="font-mono text-emerald-400 tabular-nums text-sm">{fm(race.bet)}</div>
                    </div>
                    <div className="text-right w-20">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('race_col_time')}</div>
                      <div className={`font-mono tabular-nums text-sm ${minutesLeft <= 5 ? 'text-red-400' : 'text-zinc-300'}`}>
                        {minutesLeft}m
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {race.status === 'open' && !mine && (
                        <button onClick={() => joinRace(race)} disabled={busy} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-xs rounded-lg font-semibold disabled:opacity-50">
                          {t('race_join')}
                        </button>
                      )}
                      {canStart && (
                        <button onClick={() => startRace(race)} disabled={busy} className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-xs rounded-lg font-semibold disabled:opacity-50">
                          🏁 {t('race_start')}
                        </button>
                      )}
                      {race.status === 'open' && mine && (
                        <button onClick={() => cancelRace(race)} disabled={busy} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded-lg disabled:opacity-50">
                          {t('common_cancel')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </Panel>
      </div>

      {/* History */}
      <Panel title={t('race_history_title')} icon="📜" bodyClassName="p-0">
        {history.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('race_none_history')}</div>
        ) : (
          <>
            <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <div className="col-span-4">{t('race_col_winner')}</div>
              <div className="col-span-4">{t('race_col_loser')}</div>
              <div className="col-span-2 text-right">{t('race_col_pot')}</div>
              <div className="col-span-2 text-right">{t('race_col_when')}</div>
            </div>
            {history.map((h) => {
              const loser = h.winner_name === h.poster_name ? h.joined_name : h.poster_name;
              const iWon = h.winner_name != null && h.winner_name === player?.username;
              return (
                <div key={h.id} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-xs hover:bg-zinc-800/40">
                  <div className={`col-span-4 truncate font-medium ${iWon ? 'text-emerald-400' : 'text-white'}`}>🏆 {h.winner_name || '?'}</div>
                  <div className="col-span-4 truncate text-zinc-400">{loser || '?'}</div>
                  <div className="col-span-2 text-right font-mono text-emerald-400 tabular-nums">{fm(h.bet * 2)}</div>
                  <div className="col-span-2 text-right text-zinc-500">{new Date(h.created_at).toLocaleTimeString()}</div>
                </div>
              );
            })}
          </>
        )}
      </Panel>
    </div>
  );
}
