'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface PostedRace {
  id: string;
  poster: string;
  car: string;
  bet: number;
  expireAt: number;
  joinedBy?: string;
  status: 'open' | 'ready' | 'expired';
}

interface RaceHistoryEntry {
  winner: string | null;
  loser: string | null;
  amount: number;
  time: string;
}

type RaceCar = {
  id: string;
  name: string;
  health?: number;
};

export default function RacePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const [postedRaces, setPostedRaces] = useState<PostedRace[]>([]);
  const [history, setHistory] = useState<RaceHistoryEntry[]>([]);
  const [bet, setBet] = useState(500);
  const [expireMinutes, setExpireMinutes] = useState(60);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const cars: RaceCar[] = player?.cars || [];
  const validCars = cars.filter((c) => (c.health || 100) >= 75);

  // Live countdown for posted races
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setPostedRaces((prev) =>
        prev.map((r) => {
          if (r.status === 'open' && now > r.expireAt) {
            return { ...r, status: 'expired' };
          }
          return r;
        }),
      );
      if (cooldown > 0) setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [cooldown]);

  const postRace = async () => {
    if (!player || !selectedCarId || validCars.length === 0) {
      setMessage(t('race_select_valid'));
      return;
    }
    const car = cars.find((c) => c.id === selectedCarId);
    if (!car || (car.health || 100) < 75) {
      setMessage(t('race_health_req'));
      return;
    }
    const entryFee = Math.max(100, Math.floor(bet * 0.1)); // 10% entry fee balanced
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: -entryFee, patch: {} });
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('race_entry_no_cash')
          : error.message || t('race_post_failed'),
      );
      return;
    }
    const expireAt = Date.now() + expireMinutes * 60 * 1000;
    const newRace: PostedRace = {
      id: Date.now().toString(),
      poster: player.username || 'You',
      car: car.name,
      bet,
      expireAt,
      status: 'open',
    };
    setPostedRaces((prev) => [...prev, newRace]);
    if (refreshPlayer) await refreshPlayer();
    setMessage(t('race_posted', { fee: `$${entryFee}`, minutes: expireMinutes }));
  };

  const joinRace = async (race: PostedRace) => {
    if (!player) return;
    const entryFee = Math.max(100, Math.floor(race.bet * 0.1));
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: -entryFee, patch: {} });
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('race_entry_no_cash')
          : error.message || t('race_join_failed'),
      );
      return;
    }
    setPostedRaces((prev) =>
      prev.map((r) =>
        r.id === race.id ? { ...r, joinedBy: player.username || 'Opponent', status: 'ready' } : r,
      ),
    );
    if (refreshPlayer) await refreshPlayer();
    setMessage(t('race_joined', { poster: race.poster }));
  };

  const startRace = async (race: PostedRace) => {
    if (!player || !race.joinedBy) {
      setMessage(t('race_no_opponent'));
      return;
    }
    if (cooldown > 0) {
      setMessage(t('race_cooldown_left', { seconds: cooldown }));
      return;
    }
    const win = Math.random() > 0.5;
    const pot = race.bet * 2;
    const winner = win ? player.username : race.joinedBy;
    const loser = win ? race.joinedBy : player.username;
    const delta = win ? pot : -Math.min(race.bet, player.cash);
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: delta, patch: {} });
    if (error) {
      setMessage(error.message || t('race_settle_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    setHistory((prev) => [...prev, { winner, loser, amount: pot, time: new Date().toISOString() }]);
    setMessage(
      win
        ? t('race_won', { opponent: race.joinedBy, pot: `$${pot}` })
        : t('race_lost', { opponent: race.joinedBy, bet: `$${race.bet}` }),
    );
    setCooldown(600); // 10 min
    setPostedRaces((prev) => prev.filter((r) => r.id !== race.id));
  };

  const cancelRace = (id: string) => {
    setPostedRaces((prev) => prev.filter((r) => r.id !== id));
    setMessage(t('race_canceled'));
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏁 {t('race_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('race_desc')}</p>

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
                {c.name} ({c.health || 100}%)
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
          <button onClick={postRace} className="w-full py-2 bg-red-700 rounded">
            {t('race_post_button')}
          </button>
        </div>

        {/* Open Races */}
        <div className="card p-5">
          <h3 className="font-bold mb-2">{t('race_open_title')}</h3>
          {postedRaces.length === 0 && <p className="text-xs">{t('race_none_open')}</p>}
          {postedRaces.map((race) => {
            const timeLeft = Math.max(0, Math.floor((race.expireAt - Date.now()) / 1000 / 60));
            return (
              <div key={race.id} className="mb-2 p-2 bg-zinc-950 rounded text-sm">
                {t('race_line', {
                  poster: race.poster,
                  bet: `$${race.bet}`,
                  car: race.car,
                  time: timeLeft,
                })}
                {race.status === 'open' && race.poster !== (player?.username || '') && (
                  <button
                    onClick={() => joinRace(race)}
                    className="ml-2 px-2 py-0.5 bg-emerald-700 text-xs rounded"
                  >
                    {t('race_join')}
                  </button>
                )}
                {race.status === 'ready' && (
                  <button
                    onClick={() => startRace(race)}
                    className="ml-2 px-2 py-0.5 bg-red-700 text-xs rounded"
                  >
                    {t('race_start')}
                  </button>
                )}
                <button
                  onClick={() => cancelRace(race.id)}
                  className="ml-2 px-2 py-0.5 bg-zinc-700 text-xs rounded"
                >
                  {t('common_cancel')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold mb-2">{t('race_history_title')}</h3>
        {history.length === 0 && <p className="text-xs">{t('race_none_history')}</p>}
        {history.map((h, i) => (
          <div key={i} className="text-xs mb-1">
            {t('race_history_line', {
              winner: h.winner || '?',
              loser: h.loser || '?',
              amount: `$${h.amount}`,
              time: new Date(h.time).toLocaleTimeString(),
            })}
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700">{message}</div>}

      <div className="mt-4 text-xs text-zinc-500">
        {t('race_cooldown_note', { seconds: cooldown })}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
