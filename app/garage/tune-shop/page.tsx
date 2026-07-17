'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../../components/Panel';
import { useGarage, type GarageCar } from '../../components/useGarage';
import { useEconomy } from '@/lib/economy';

type TuningPart = {
  partId: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  cost: number;
  bonus: number;
};

export const dynamic = 'force-dynamic';

// Standalone Tune Shop (bug-inspectie): basic tune + performance parts.
// Split out of the old all-in-one garage page.
export default function TuneShopPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const { cars, loading, reload } = useGarage();
  const economy = useEconomy();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Live catalog from the server (mirrors migration 051 garage_buy_part).
  const TUNING_PARTS: TuningPart[] = (economy?.tuning_parts ?? [
    { part_id: 'engine', cost: 2500, bonus: 5 },
    { part_id: 'turbo', cost: 4000, bonus: 8 },
    { part_id: 'brakes', cost: 1500, bonus: 3 },
    { part_id: 'bodykit', cost: 1200, bonus: 2 },
  ]).map((p) => ({
    partId: p.part_id,
    nameKey: `garage_part_${p.part_id}` as TranslationKey,
    descKey: `garage_part_${p.part_id}_desc` as TranslationKey,
    cost: p.cost,
    bonus: p.bonus,
  }));

  const supabase = createClient();

  const afterAction = async (msg: string) => {
    await reload();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(msg);
  };

  const tuneCar = async (car: GarageCar) => {
    setBusy(true);
    const { error } = await supabase.rpc('garage_tune_car', { p_car_id: car.id });
    setBusy(false);
    if (error) {
      if (error.message.includes('TUNE_NEEDS_REPAIR')) setMessage(t('garage_tune_first'));
      else if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('garage_repair_no_cash'));
      else setMessage(t('garage_action_failed'));
      return;
    }
    await afterAction(t('garage_tuned'));
  };

  const buyPart = async (car: GarageCar, part: TuningPart) => {
    setBusy(true);
    const { error } = await supabase.rpc('garage_buy_part', { p_car_id: car.id, p_part_id: part.partId });
    setBusy(false);
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? t('garage_part_no_cash') : t('garage_action_failed'));
      return;
    }
    await afterAction(t('garage_part_applied', { part: t(part.nameKey), car: car.name, bonus: part.bonus }));
  };

  if (!player || loading) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🔧 {t('menu_tune_shop')}</h1>
          <p className="text-xs text-zinc-400">{t('ts_subtitle')}</p>
        </div>
        <Link href="/garage" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">🚙 {t('menu_garage')}</Link>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {cars.length === 0 ? (
        <Panel title={t('ts_bays')} icon="🔧">
          <p className="text-sm text-zinc-500">
            {t('gr_no_cars')} <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cars.map((car) => {
            const needsRepair = car.condition < 100;
            return (
              <Panel
                key={car.id}
                title={car.name}
                icon="🚗"
                actions={
                  <span className="text-[10px] text-zinc-500">
                    {car.condition}% • +{car.speed_bonus ?? 0} 🏁
                  </span>
                }
              >
                {/* Basic tune */}
                <div className="mb-3">
                  <button
                    onClick={() => tuneCar(car)}
                    disabled={busy || car.tuned || needsRepair}
                    className="w-full py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {car.tuned ? `✅ ${t('gr_tuned')}` : t('garage_basic_tune', { name: car.name })}
                  </button>
                  {needsRepair && !car.tuned && (
                    <p className="text-[11px] text-amber-400 mt-1">{t('garage_tune_first')}</p>
                  )}
                </div>

                {/* Parts */}
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('garage_parts_label')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {TUNING_PARTS.map((part) => (
                    <button
                      key={part.partId}
                      onClick={() => buyPart(car, part)}
                      disabled={busy}
                      className="text-left px-2.5 py-2 bg-zinc-950 border border-zinc-800 hover:border-emerald-700 rounded-lg text-xs disabled:opacity-40"
                    >
                      <div className="font-semibold">{t(part.nameKey)}</div>
                      <div className="text-[10px] text-zinc-500">{t(part.descKey)}</div>
                      <div className="text-[10px] text-emerald-400 font-mono mt-0.5">{fm(part.cost)} • +{part.bonus}</div>
                    </button>
                  ))}
                </div>

                {(car.mods?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {car.mods!.map((m) => (
                      <span key={m} className="text-[10px] px-1.5 py-px bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      <div className="text-[11px] text-zinc-500">{t('ts_footer')}</div>
    </div>
  );
}
