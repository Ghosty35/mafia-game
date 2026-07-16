'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

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
    setMessage(t('race_canceled') + (data?.refunded ? ` (+${fm(data.refunded)} refunded)` : ''));
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏁 {t('race_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('race_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Post Race */}
        <div className="card p-5">
          <h3 className="font-bold mb-2">{t('race_post_title')}</h3>
          <select
            value={selectedCarId}
            onChange={(e) => setSelectedCarId(e.target.value)}
            className="mb-2 w-full bg-zinc-900 border px-2 py-1"
          >
            <option value="">{t('race_select_car')}</option>
            {validCars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.condition || 100}%)
              </option>
            ))}
          </select>
          <div className="mb-2">
            {t('race_bet_label')}{' '}
            <input
              type="number"
              value={bet}
              onChange={(e) => setBet(parseInt(e.target.value) || 500)}
              className="bg-zinc-900 px-2 py-1 w-24"
            />
          </div>
          <select
            value={expireMinutes}
            onChange={(e) => setExpireMinutes(parseInt(e.target.value))}
            className="mb-2 bg-zinc-900 px-2 py-1"
          >
            <option value={5}>{t('race_5min')}</option>
            <option value={15}>{t('race_15min')}</option>
            <option value={60}>{t('race_1hour')}</option>
            <option value={120}>{t('race_2hours')}</option>
          </select>
          <button onClick={postRace} disabled={busy} className="w-full py-2 bg-red-700 rounded disabled:opacity-50">
            {t('race_post_button')}
          </button>
        </div>

        {/* Open Races */}
        <div className="card p-5">
          <h3 className="font-bold mb-2">{t('race_open_title')}</h3>
          {openRaces.length === 0 && <p className="text-xs">{t('race_none_open')}</p>}
          {openRaces.map((race) => {
            const timeLeft = race.expire_at
              ? Math.max(0, Math.floor((new Date(race.expire_at).getTime() - Date.now()) / 1000 / 60))
              : 0;
            return (
              <div key={race.id} className="mb-2 p-2 bg-zinc-950 rounded text-sm">
                {t('race_line', {
                  poster: race.poster_name,
                  bet: fm(race.bet),
                  car: race.car_name,
                  time: timeLeft,
                })}
                {race.status === 'open' && race.poster_id !== player?.id && (
                  <button
                    onClick={() => joinRace(race)}
                    disabled={busy}
                    className="ml-2 px-2 py-0.5 bg-emerald-700 text-xs rounded disabled:opacity-50"
                  >
                    {t('race_join')}
                  </button>
                )}
                {race.status === 'ready' && (race.poster_id === player?.id || race.joined_by === player?.id) && (
                  <button
                    onClick={() => startRace(race)}
                    disabled={busy}
                    className="ml-2 px-2 py-0.5 bg-red-700 text-xs rounded disabled:opacity-50"
                  >
                    {t('race_start')}
                  </button>
                )}
                {race.status === 'open' && race.poster_id === player?.id && (
                  <button
                    onClick={() => cancelRace(race)}
                    disabled={busy}
                    className="ml-2 px-2 py-0.5 bg-zinc-700 text-xs rounded disabled:opacity-50"
                  >
                    {t('common_cancel')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold mb-2">{t('race_history_title')}</h3>
        {history.length === 0 && <p className="text-xs">{t('race_none_history')}</p>}
        {history.map((h) => (
          <div key={h.id} className="text-xs mb-1">
            {t('race_history_line', {
              winner: h.winner_name || '?',
              loser: h.winner_name === h.poster_name ? h.joined_name || '?' : h.poster_name,
              amount: fm(h.bet * 2),
              time: new Date(h.created_at).toLocaleTimeString(),
            })}
          </div>
        ))}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
