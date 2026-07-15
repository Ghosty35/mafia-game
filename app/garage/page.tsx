'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

// Car ids are now player_cars UUIDs; value is derived server-side (get_garage).
type Car = {
  id: string;
  catalog_id?: string;
  name: string;
  condition: number;
  value: number;
  tuned: boolean;
  speed_bonus?: number;
  mods?: string[];
};

type TuningPart = {
  partId: string;
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
  const [cars, setCars] = useState<Car[]>([]);
  const [garageLevel, setGarageLevel] = useState(0);

  // Garage state is server-authoritative: cars + level come from get_garage().
  const loadGarage = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_garage');
    if (!error && data) {
      setCars((data.cars as Car[]) || []);
      setGarageLevel((data.garage_level as number) || 0);
    }
  }, []);

  useEffect(() => {
    loadGarage();
  }, [loadGarage]);

  const ownedProps = player?.owned_properties || [];
  const hasHouse = ownedProps.some((p) => p.name.includes('House'));
  const hasVilla = ownedProps.some((p) => p.name.includes('Villa'));
  const hasMansion = ownedProps.some((p) => p.name.includes('Mansion'));

  let maxCars = 0;
  if (hasMansion) maxCars = 8 + garageLevel * 10;
  else if (hasVilla) maxCars = 4 + garageLevel * 4;
  else if (hasHouse) maxCars = 2;

  if (!player) return <div className="p-8">{t('loading')}</div>;

  // Shared helper: run a garage RPC, then reload garage + player state.
  const afterAction = async (successMsg: string) => {
    await loadGarage();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(successMsg);
  };

  const warehouseUpgrade = async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('garage_upgrade_warehouse');
    if (error) {
      setMessage(
        error.message.includes('NEED_VILLA_OR_MANSION')
          ? t('garage_need_villa')
          : error.message.includes('NOT_ENOUGH_CASH')
            ? t('garage_upgrade_no_cash')
            : error.message || t('garage_action_failed'),
      );
      return;
    }
    const newLevel = (data?.garage_level as number) ?? garageLevel + 1;
    const newMax = hasMansion ? 8 + newLevel * 10 : 4 + newLevel * 4;
    await afterAction(t('garage_upgraded', { level: newLevel, max: newMax }));
  };

  const repairCar = async (car: Car) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('garage_repair_car', { p_car_id: car.id });
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('garage_repair_no_cash')
          : error.message || t('garage_action_failed'),
      );
      return;
    }
    const cost = (data?.cost as number) ?? 0;
    await afterAction(t('garage_repaired', { cost: `$${cost}` }));
  };

  const tuneCar = async (car: Car) => {
    const supabase = createClient();
    const { error } = await supabase.rpc('garage_tune_car', { p_car_id: car.id });
    if (error) {
      setMessage(
        error.message.includes('TUNE_NEEDS_REPAIR')
          ? t('garage_tune_first')
          : error.message.includes('NOT_ENOUGH_CASH')
            ? t('garage_repair_no_cash')
            : error.message || t('garage_action_failed'),
      );
      return;
    }
    await afterAction(t('garage_tuned'));
  };

  const tuningParts: TuningPart[] = [
    { partId: 'engine', nameKey: 'garage_part_engine', descKey: 'garage_part_engine_desc', cost: 2500, bonus: 5 },
    { partId: 'turbo', nameKey: 'garage_part_turbo', descKey: 'garage_part_turbo_desc', cost: 4000, bonus: 8 },
    { partId: 'brakes', nameKey: 'garage_part_brakes', descKey: 'garage_part_brakes_desc', cost: 1500, bonus: 3 },
    { partId: 'bodykit', nameKey: 'garage_part_bodykit', descKey: 'garage_part_bodykit_desc', cost: 1200, bonus: 2 },
  ];

  const buyTuningPart = async (car: Car, part: TuningPart) => {
    const partName = t(part.nameKey);
    const supabase = createClient();
    const { error } = await supabase.rpc('garage_buy_part', {
      p_car_id: car.id,
      p_part_id: part.partId,
    });
    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('garage_part_no_cash')
          : error.message || t('garage_action_failed'),
      );
      return;
    }
    await afterAction(
      t('garage_part_applied', { part: partName, car: car.name, bonus: part.bonus }),
    );
  };

  const sellCar = async (car: Car) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('garage_sell_car', { p_car_id: car.id });
    if (error) {
      setMessage(error.message || t('garage_action_failed'));
      return;
    }
    const sale = (data?.sale as number) ?? 0;
    await afterAction(t('garage_sold', { price: `$${sale}` }));
  };

  const crushCar = async (car: Car) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('garage_crush_car', { p_car_id: car.id });
    if (error) {
      setMessage(error.message || t('garage_action_failed'));
      return;
    }
    const bullets = (data?.bullets_gained as number) ?? 15;
    await afterAction(t('garage_crushed', { bullets }));
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
            .map((car) => (
              <div key={car.id} className="mt-2">
                <button
                  onClick={() => tuneCar(car)}
                  className="text-sm bg-blue-600 px-2 py-1 rounded"
                >
                  {t('garage_basic_tune', { name: car.name })}
                </button>
                <div className="mt-1 text-xs">{t('garage_parts_label')}</div>
                {tuningParts.map((part) => (
                  <button
                    key={part.partId}
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
          {cars.map((car) => (
            <div key={car.id} className="mt-2 flex justify-between">
              <span>
                {car.name} ({car.condition}%)
              </span>
              <button onClick={() => repairCar(car)} className="text-sm bg-blue-600 px-2 py-1 rounded">
                {t('garage_repair_button')}
              </button>
            </div>
          ))}
        </div>

        {/* Owned cars: sell */}
        <div className="card p-5">
          <h3 className="font-bold">{t('garage_marketplace_title')}</h3>
          <p className="text-xs">{t('garage_marketplace_desc')}</p>
          {cars.map((car) => (
            <div key={car.id} className="mt-2">
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
          {cars.map((car) => (
            <div key={car.id} className="mt-2">
              <button onClick={() => crushCar(car)} className="text-sm bg-red-600 px-2 py-1 rounded">
                {t('garage_crush_button', { name: car.name })}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Racing now lives on the dedicated /race page (server-authoritative). */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold">{t('garage_racing_title')}</h3>
        <p className="text-sm text-zinc-400">{t('garage_racing_desc')}</p>
        <Link href="/race" className="mt-2 inline-block px-3 py-1 bg-red-700 rounded text-sm">
          {t('garage_race_button')}
        </Link>
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
