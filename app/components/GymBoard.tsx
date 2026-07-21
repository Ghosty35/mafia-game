'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';

type Discipline = 'strength' | 'defense';

const STAMINA_PER_SESSION = 20;

// Mirrors gym_train: each session costs $250 + stat*15, stat +1 per session.
function cashCost(startStat: number, sessions: number): number {
  let total = 0;
  for (let i = 0; i < sessions; i++) total += 250 + (startStat + i) * 15;
  return total;
}

export default function GymBoard() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const [discipline, setDiscipline] = useState<Discipline>('strength');
  const [sessions, setSessions] = useState(1);
  const [busy, setBusy] = useState(false);

  const stamina = player?.stamina ?? 100;
  const strength = player?.strength ?? 10;
  const defense = player?.defense ?? 10;
  const isDonator = !!player?.is_donator;
  const regenPerHour = isDonator ? 90 : 60;

  const currentStat = discipline === 'strength' ? strength : defense;
  const totalCash = useMemo(() => cashCost(currentStat, sessions), [currentStat, sessions]);
  const totalStamina = STAMINA_PER_SESSION * sessions;

  const mapErr = (msg: string): string => {
    if (msg.includes('NOT_ENOUGH_STAMINA')) return t('error_no_stamina');
    if (msg.includes('NOT_ENOUGH_CASH')) return t('common_not_enough_cash');
    if (msg.includes('IN_JAIL')) return t('gym_err_jail');
    if (msg.includes('DEAD')) return t('gym_err_dead');
    if (msg.includes('INVALID_SESSIONS')) return t('gym_err_sessions');
    if (msg.includes('TOO_FAST')) return t('error_too_fast');
    return msg;
  };

  const train = async () => {
    if (busy || !player) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('gym_train', {
        p_discipline: discipline,
        p_sessions: sessions,
      });
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      showToast(
        t('gym_success', {
          gained: data?.gained ?? sessions,
          discipline: t(discipline === 'strength' ? 'gym_strength' : 'gym_defense'),
          stat: data?.new_stat ?? currentStat + sessions,
          cost: fm(Number(data?.cost ?? totalCash)),
        }),
        'success',
      );
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stamina */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-zinc-300 flex items-center gap-2">
            <span className="text-lg">⚡</span>
            {t('gym_stamina')}
          </span>
          <span className="font-mono text-cyan-400 font-bold">{stamina}/100</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-3 bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, stamina))}%` }}
          />
        </div>
        <p className="text-[10px] text-zinc-500 mt-2">
          {t('gym_regen_note', { rate: regenPerHour })}
          {isDonator && <span className="text-amber-400"> {t('gym_regen_donator')}</span>}
        </p>
      </div>

      {/* Discipline pick */}
      <div className="grid grid-cols-2 gap-3">
        {(['strength', 'defense'] as Discipline[]).map((d) => {
          const active = discipline === d;
          const stat = d === 'strength' ? strength : defense;
          return (
            <button
              key={d}
              onClick={() => setDiscipline(d)}
              className={`group border rounded-xl p-4 text-left transition-all ${
                active
                  ? 'border-amber-700/60 bg-amber-950/30 shadow-[0_0_15px_rgba(245,158,11,0.08)]'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <div className="font-bold mb-1 flex items-center gap-2">
                <span className="text-xl">{d === 'strength' ? '💪' : '🛡️'}</span>
                {t(d === 'strength' ? 'gym_strength' : 'gym_defense')}
                {active && <span className="text-xs text-amber-400 font-semibold ml-auto">ACTIVE</span>}
              </div>
              <div className="text-xs text-zinc-400">
                {t('gym_stat_current')}: <span className="font-mono text-amber-400 font-bold">{stat}</span>
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">
                {t(d === 'strength' ? 'gym_strength_effect' : 'gym_defense_effect')}
              </div>
            </button>
          );
        })}
      </div>

      {/* Train form (input field — no spam clicking) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <label className="block">
          <span className="text-zinc-400 text-xs uppercase tracking-wider mb-2 block">{t('gym_sessions')}</span>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={10}
              value={sessions || ''}
              onChange={(e) =>
                setSessions(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))
              }
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-amber-700"
            />
            <button
              onClick={() => setSessions(Math.max(1, Math.min(10, Math.floor(stamina / STAMINA_PER_SESSION))))}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-semibold transition-colors"
            >
              {t('gym_max_sessions')}
            </button>
          </div>
        </label>

        <div className="text-xs text-zinc-400 space-y-1.5 bg-zinc-950 rounded-lg p-3 border border-zinc-800">
          <div className="flex justify-between">
            <span>{t('gym_cost_preview', { cash: fm(totalCash), stamina: totalStamina })}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('gym_gain_preview', {
              gained: sessions,
              discipline: t(discipline === 'strength' ? 'gym_strength' : 'gym_defense'),
              stat: currentStat + sessions,
            })}</span>
          </div>
        </div>

        <button
          onClick={train}
          disabled={busy || totalStamina > stamina || (player?.cash ?? 0) < totalCash}
          className="w-full py-3 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-bold text-sm transition-colors"
        >
          🏋️ {t('gym_train_btn')}
        </button>

        {totalStamina > stamina && (
          <p className="text-[10px] text-orange-400">{t('gym_not_enough_stamina_hint')}</p>
        )}
        <p className="text-[10px] text-zinc-500">{t('gym_note')}</p>
      </div>
    </div>
  );
}
