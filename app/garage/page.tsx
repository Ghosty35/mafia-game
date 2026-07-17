'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';
import { useGarage, maxCarsFor, type GarageCar } from '../components/useGarage';

export const dynamic = 'force-dynamic';

// The garage proper: your cars, the fuel pump (075) and body repair.
// Tuning and crushing now live on their own pages (/garage/tune-shop,
// /garage/junkyard) per the bug-inspectie menu spec.
export default function GaragePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const { cars, garageLevel, fuelPrice, loading, reload } = useGarage();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const supabase = createClient();
  const maxCars = maxCarsFor(player?.owned_properties, garageLevel);

  const afterAction = async (msg: string) => {
    await reload();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(msg);
  };

  const refuel = async (car: GarageCar, litres: number) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('garage_refuel_car', {
      p_car_id: car.id,
      p_litres: litres,
    });
    setBusy(false);
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (error.message.includes('TANK_FULL')) setMessage(t('gr_tank_full'));
      else if (error.message.includes('IN_JAIL')) setMessage(t('error_in_jail'));
      else setMessage(t('garage_action_failed'));
      return;
    }
    await afterAction(t('gr_refuelled', { litres: data.litres, cost: fm(data.cost), car: car.name }));
  };

  const repairCar = async (car: GarageCar) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('garage_repair_car', { p_car_id: car.id });
    setBusy(false);
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? t('garage_repair_no_cash') : t('garage_action_failed'));
      return;
    }
    await afterAction(t('garage_repaired', { cost: fm((data?.cost as number) ?? 0) }));
  };

  const sellCar = async (car: GarageCar) => {
    if (!confirm(t('gr_confirm_sell', { name: car.name }))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('garage_sell_car', { p_car_id: car.id });
    setBusy(false);
    if (error) {
      setMessage(t('garage_action_failed'));
      return;
    }
    await afterAction(t('garage_sold', { price: fm((data?.sale as number) ?? 0) }));
  };

  const warehouseUpgrade = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('garage_upgrade_warehouse');
    setBusy(false);
    if (error) {
      setMessage(
        error.message.includes('NEED_VILLA_OR_MANSION')
          ? t('garage_need_villa')
          : error.message.includes('NOT_ENOUGH_CASH')
            ? t('garage_upgrade_no_cash')
            : t('garage_action_failed'),
      );
      return;
    }
    const newLevel = (data?.garage_level as number) ?? garageLevel + 1;
    await afterAction(t('garage_upgraded', { level: newLevel, max: maxCarsFor(player?.owned_properties, newLevel) }));
  };

  if (!player || loading) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const canUpgrade = (player.owned_properties ?? []).some(
    (p: { name: string }) => p.name.includes('Villa') || p.name.includes('Mansion'),
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🚙 {t('garage_title')}</h1>
          <p className="text-xs text-zinc-400">
            {t('gr_slots', { used: cars.length, max: maxCars })}
            {fuelPrice != null && (
              <span className="ml-2 text-zinc-500">• ⛽ {t('gr_pump_price', { price: fm(fuelPrice) })}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/garage/tune-shop" className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-all">🔧 {t('menu_tune_shop')}</Link>
          <Link href="/garage/junkyard" className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-all">🗜️ {t('menu_junkyard')}</Link>
        </div>
      </div>

      {message && <div className="bg-zinc-900 border border-amber-800/50 rounded-xl px-4 py-3 text-sm text-amber-300">{message}</div>}

      {maxCars === 0 && (
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-3 text-sm text-amber-300">
          {t('garage_locked')}{' '}
          <Link href="/real-estate" className="text-red-400 hover:underline">{t('menu_real_estate')}</Link>
        </div>
      )}

      {/* Cars */}
      {cars.length === 0 ? (
        <Panel title={t('gr_your_cars')} icon="🚗">
          <p className="text-sm text-zinc-500">{t('gr_no_cars')}</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cars.map((car) => {
            const fuelPct = car.fuel_tank > 0 ? (car.fuel / car.fuel_tank) * 100 : 0;
            const roomLeft = car.fuel_tank - car.fuel;
            return (
              <Panel
                key={car.id}
                title={
                  <div className="flex items-center justify-between gap-2">
                    <span>{car.name}</span>
                    {car.tuned && <span className="text-[10px] px-2 py-px bg-blue-900/60 text-blue-300 rounded uppercase tracking-wider">{t('gr_tuned')}</span>}
                  </div>
                }
                icon="🚗"
              >
                {/* Condition */}
                <div className="mb-4">
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1.5">
                    <span>🔧 {t('gr_condition')}</span>
                    <span className="font-mono text-white font-semibold">{car.condition}%</span>
                  </div>
                  <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${car.condition < 25 ? 'bg-red-600' : car.condition < 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${car.condition}%` }}
                    />
                  </div>
                </div>

                {/* Fuel */}
                <div className="mb-4">
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1.5">
                    <span>⛽ {t('tv_fuel')}</span>
                    <span className="font-mono text-white font-semibold">{car.fuel}/{car.fuel_tank}L • {t('tv_range', { km: (car.fuel * 50).toLocaleString() })}</span>
                  </div>
                  <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${fuelPct < 25 ? 'bg-red-600' : 'bg-emerald-500'}`}
                      style={{ width: `${fuelPct}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => refuel(car, roomLeft)}
                    disabled={busy || roomLeft <= 0 || fuelPrice == null}
                    className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors"
                  >
                    ⛽ {roomLeft > 0 && fuelPrice != null
                      ? t('gr_fill_up', { litres: roomLeft, cost: fm(roomLeft * fuelPrice) })
                      : t('gr_tank_full')}
                  </button>
                  <button
                    onClick={() => refuel(car, 10)}
                    disabled={busy || roomLeft <= 0 || fuelPrice == null}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs disabled:opacity-40 transition-colors"
                  >
                    +10L
                  </button>
                  <button
                    onClick={() => repairCar(car)}
                    disabled={busy || car.condition >= 100}
                    className="px-3 py-2 bg-blue-800 hover:bg-blue-700 border border-blue-700 rounded-lg text-xs disabled:opacity-40 transition-colors"
                  >
                    🔧 {t('garage_repair_button')}
                  </button>
                  <button
                    onClick={() => sellCar(car)}
                    disabled={busy}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs ml-auto disabled:opacity-40 transition-colors"
                  >
                    💵 {fm(Math.floor(car.value * (car.condition / 100)))}
                  </button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Warehouse upgrade */}
      {canUpgrade && (
        <Panel title={t('garage_upgrade_warehouse')} icon="🏗️" variant="default">
          <p className="text-xs text-zinc-400 mb-3">{t('garage_upgrade_note')}</p>
          <button onClick={warehouseUpgrade} disabled={busy} className="px-4 py-2.5 bg-blue-700 hover:bg-blue-600 border border-blue-600 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
            {t('garage_upgrade_warehouse')}
          </button>
        </Panel>
      )}

      <div className="flex gap-3 text-xs">
        <Link href="/race" className="text-amber-400 hover:text-amber-300 transition-colors">🏁 {t('menu_race')}</Link>
        <Link href="/travel" className="text-amber-400 hover:text-amber-300 transition-colors">🧭 {t('menu_travel')}</Link>
      </div>
    </div>
  );
}
