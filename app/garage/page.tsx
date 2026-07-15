'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type Car = {
  id: string;
  name: string;
  condition: number;
  value: number;
  tuned: boolean;
  speed_bonus?: number;
  mods?: string[];
  pinkslip?: boolean;
};

type TuningPart = {
  nameKey: TranslationKey;
  descKey: TranslationKey;
  cost: number;
  bonus: number;
};

export default function GaragePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [bet, setBet] = useState(500); // racing bet state

  if (!player) return <div className="p-8">{t('loading')}</div>;

  const ownedProps = player.owned_properties || [];
  const hasHouse = ownedProps.some((p) => p.name.includes('House'));
  const hasVilla = ownedProps.some((p) => p.name.includes('Villa'));
  const hasMansion = ownedProps.some((p) => p.name.includes('Mansion'));

  let maxCars = 0;
  let garageLevel = 0;
  if (hasMansion) {
    maxCars = 8 + 10;
    garageLevel = 3;
  } // mansion +10
  else if (hasVilla) {
    maxCars = 4;
    garageLevel = 1;
  } // base villa 4, upgrade later
  else if (hasHouse) {
    maxCars = 2;
    garageLevel = 0;
  }

  // Demo cars tied to property
  let cars: Car[] = player.cars || [];
  if (cars.length === 0 && hasHouse) {
    cars = [
      { id: 'c1', name: 'Old Sedan', condition: 70, value: 2000, tuned: false },
      { id: 'c2', name: 'Sports Car', condition: 90, value: 8000, tuned: true },
    ];
  }

  // Shared persistence helper: every garage action goes through the
  // apply_action RPC so cash + cars survive navigation and refresh.
  const applyGarage = async (
    cashDelta: number,
    patch: Record<string, unknown>,
    successMsg: string,
    notEnoughMsg?: string,
  ) => {
    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', { cash_delta: cashDelta, patch });
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? notEnoughMsg || t('common_not_enough_cash')
          : error.message || t('garage_action_failed'),
      );
      return false;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(successMsg);
    return true;
  };

  const warehouseUpgrade = async () => {
    if (!hasVilla && !hasMansion) {
      setMessage(t('garage_need_villa'));
      return;
    }
    const cost = 10000 * (garageLevel + 1);
    const newLevel = garageLevel + 1;
    const newMax = hasMansion ? 8 + newLevel * 10 : newLevel * 25;
    await applyGarage(
      -cost,
      { garage_level: newLevel },
      t('garage_upgraded', { level: newLevel, max: newMax }),
      t('garage_upgrade_no_cash'),
    );
  };

  const repairCar = async (car: Car) => {
    const repairCost = Math.floor((100 - car.condition) * 50);
    const updatedCars = cars.map((c) => (c.id === car.id ? { ...c, condition: 100 } : c));
    await applyGarage(
      -repairCost,
      { cars: updatedCars },
      t('garage_repaired', { cost: `$${repairCost}` }),
      t('garage_repair_no_cash'),
    );
  };

  const tuneCar = async (car: Car) => {
    if (car.condition < 100) {
      setMessage(t('garage_tune_first'));
      return;
    }
    const tuneCost = 1000;
    const updatedCars = cars.map((c) =>
      c.id === car.id ? { ...c, tuned: true, value: c.value + 2000 } : c,
    );
    await applyGarage(-tuneCost, { cars: updatedCars }, t('garage_tuned'));
  };

  // Tuning Parts Shop - purchase and apply for small speed bonuses
  const tuningParts: TuningPart[] = [
    { nameKey: 'garage_part_engine', descKey: 'garage_part_engine_desc', cost: 2500, bonus: 5 },
    { nameKey: 'garage_part_turbo', descKey: 'garage_part_turbo_desc', cost: 4000, bonus: 8 },
    { nameKey: 'garage_part_brakes', descKey: 'garage_part_brakes_desc', cost: 1500, bonus: 3 },
    { nameKey: 'garage_part_bodykit', descKey: 'garage_part_bodykit_desc', cost: 1200, bonus: 2 },
  ];

  const buyTuningPart = async (car: Car, part: TuningPart) => {
    const partName = t(part.nameKey);
    const updatedCars = cars.map((c) => {
      if (c.id === car.id) {
        const currentBonus = c.speed_bonus || 0;
        return {
          ...c,
          speed_bonus: currentBonus + part.bonus,
          value: c.value + Math.floor(part.cost * 0.5),
          mods: [...(c.mods || []), partName],
        };
      }
      return c;
    });
    await applyGarage(
      -part.cost,
      { cars: updatedCars },
      t('garage_part_applied', { part: partName, car: car.name, bonus: part.bonus }),
      t('garage_part_no_cash'),
    );
  };

  const sellCar = async (car: Car) => {
    const sellPrice = Math.floor(car.value * (car.condition / 100));
    const updatedCars = cars.filter((c) => c.id !== car.id);
    await applyGarage(sellPrice, { cars: updatedCars }, t('garage_sold', { price: `$${sellPrice}` }));
  };

  const crushCar = async (car: Car) => {
    const bullets = 15; // small, city vary in real
    const updatedCars = cars.filter((c) => c.id !== car.id);
    await applyGarage(
      0,
      { cars: updatedCars, bullets: (player.bullets || 0) + bullets },
      t('garage_crushed', { bullets }),
    );
  };

  const startRace = async () => {
    // Basic race with bet/pinkslip
    if (!selectedCar) {
      setMessage(t('garage_select_car'));
      return;
    }
    const win = Math.random() > 0.5;
    const gain = 500;
    if (win) {
      await applyGarage(gain, {}, t('garage_race_won', { gain: `$${gain}` }));
    } else {
      const loss = Math.min(gain, player.cash);
      if (selectedCar.pinkslip) {
        const updatedCars = cars.filter((c) => c.id !== selectedCar.id);
        await applyGarage(-loss, { cars: updatedCars }, t('garage_race_lost_pinkslip'));
      } else {
        await applyGarage(-loss, {}, t('garage_race_lost', { loss: `$${gain}` }));
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🚗 {t('garage_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('garage_desc', { max: maxCars })}</p>

      {message && <div className="mb-4 text-sm p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      {!hasHouse && !hasVilla && !hasMansion && (
        <div className="text-red-400 mb-4">{t('garage_locked')}</div>
      )}

      {(hasVilla || hasMansion) && (
        <div className="mb-4">
          <button onClick={warehouseUpgrade} className="px-4 py-2 bg-blue-700 rounded">
            {t('garage_upgrade_warehouse')}
          </button>
          <p className="text-xs">{t('garage_upgrade_note')}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Tune Shop */}
        <div className="card p-5">
          <h3 className="font-bold">{t('garage_tune_shop_title')}</h3>
          <p className="text-xs">{t('garage_tune_shop_desc')}</p>
          {cars
            .filter((c) => c.condition === 100)
            .map((car, i) => (
              <div key={i} className="mt-2">
                <button
                  onClick={() => tuneCar(car)}
                  className="text-sm bg-blue-600 px-2 py-1 rounded"
                >
                  {t('garage_basic_tune', { name: car.name })}
                </button>
                <div className="mt-1 text-xs">{t('garage_parts_label')}</div>
                {tuningParts.map((part, pi) => (
                  <button
                    key={pi}
                    onClick={() => buyTuningPart(car, part)}
                    className="text-xs bg-emerald-700 px-2 py-0.5 rounded mr-1 mt-1"
                  >
                    {t(part.nameKey)} (${part.cost}) {t(part.descKey)}
                  </button>
                ))}
              </div>
            ))}
        </div>

        {/* Body Repair */}
        <div className="card p-5">
          <h3 className="font-bold">{t('garage_repair_title')}</h3>
          <p className="text-xs">{t('garage_repair_desc')}</p>
          {cars.map((car, i) => (
            <div key={i} className="mt-2 flex justify-between">
              <span>
                {car.name} ({car.condition}%)
              </span>
              <button onClick={() => repairCar(car)} className="text-sm bg-blue-600 px-2 py-1 rounded">
                {t('garage_repair_button')}
              </button>
            </div>
          ))}
        </div>

        {/* Car Marketplace with Categories and Images */}
        <div className="card p-5">
          <h3 className="font-bold">{t('garage_marketplace_title')}</h3>
          <p className="text-xs">{t('garage_marketplace_desc')}</p>

          {/* Low End Examples */}
          <div className="mt-2">
            <div className="font-semibold text-xs">{t('garage_low_end_label')}</div>
            <div className="flex flex-wrap gap-2 mt-1">
              {['Honda Civic', 'Toyota Corolla', 'Ford Focus', 'VW Golf'].map((name, idx) => (
                <div key={idx} className="text-xs">
                  <img src={`https://picsum.photos/id/${20 + idx}/80/40`} alt={name} className="rounded" />
                  {name} (base speed 85)
                </div>
              ))}
            </div>
          </div>

          {/* Mid Range */}
          <div className="mt-2">
            <div className="font-semibold text-xs">{t('garage_mid_label')}</div>
            <div className="flex flex-wrap gap-2 mt-1">
              {['Lexus IS', 'Mercedes C-Class', 'Nissan Altima'].map((name, idx) => (
                <div key={idx} className="text-xs">
                  <img src={`https://picsum.photos/id/${30 + idx}/80/40`} alt={name} className="rounded" />
                  {name} (base 105)
                </div>
              ))}
            </div>
          </div>

          {cars.map((car, i) => (
            <div key={i} className="mt-2">
              <button onClick={() => sellCar(car)} className="text-sm bg-emerald-600 px-2 py-1 rounded">
                {t('garage_sell_button', {
                  name: car.name,
                  price: `$${Math.floor(car.value * (car.condition / 100))}`,
                })}
              </button>
            </div>
          ))}
        </div>

        {/* Junkyard */}
        <div className="card p-5">
          <h3 className="font-bold">{t('garage_junkyard_title')}</h3>
          <p className="text-xs">{t('garage_junkyard_desc')}</p>
          {cars.map((car, i) => (
            <div key={i} className="mt-2">
              <button onClick={() => crushCar(car)} className="text-sm bg-red-600 px-2 py-1 rounded">
                {t('garage_crush_button', { name: car.name })}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Racing with bet/pinkslip */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold">{t('garage_racing_title')}</h3>
        <p>{t('garage_racing_desc')}</p>
        <select
          onChange={(e) => setSelectedCar(cars.find((c) => c.id == e.target.value) || null)}
          className="bg-zinc-900 p-1"
        >
          {cars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.condition}%)
            </option>
          ))}
        </select>
        <input
          type="number"
          value={bet}
          onChange={(e) => setBet(parseInt(e.target.value))}
          className="ml-2 bg-zinc-900 p-1 w-20"
        />
        <label className="ml-2">
          <input
            type="checkbox"
            onChange={(e) =>
              selectedCar && setSelectedCar({ ...selectedCar, pinkslip: e.target.checked })
            }
          />{' '}
          {t('garage_pinkslip')}
        </label>
        <button onClick={startRace} className="ml-2 px-3 py-1 bg-red-700 rounded">
          {t('garage_race_button')}
        </button>
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
