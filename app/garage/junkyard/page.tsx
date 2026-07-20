'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';
import { useGarage, type GarageCar } from '../../components/useGarage';
import CarImage from '../../components/CarImage';
import { useEconomy } from '@/lib/economy';

export const dynamic = 'force-dynamic';

// Standalone Junkyard (bug-inspectie): crush cars into bullets. Split out of
// the old all-in-one garage page. Crushing is destructive and irreversible,
// so it confirms first and states what the car is still worth sold.
export default function JunkyardPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const { cars, loading, reload } = useGarage();
  const economy = useEconomy();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const supabase = createClient();
  const crushBullets = economy?.crush_bullets ?? 15;

  const crushCar = async (car: GarageCar) => {
    if (!confirm(t('jy_confirm', { name: car.name, price: fm(crushBullets) }))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('garage_crush_car', { p_car_id: car.id });
    setBusy(false);
    if (error) {
      setMessage(t('garage_action_failed'));
      return;
    }
    await reload();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(t('garage_crushed', { bullets: (data?.bullets_gained as number) ?? crushBullets }));
  };

  if (!player || loading) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🗜️ {t('menu_junkyard')}</h1>
          <p className="text-xs text-zinc-400">{t('jy_subtitle')}</p>
        </div>
        <Link href="/garage" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">🚙 {t('menu_garage')}</Link>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      <div className="bg-amber-950/40 border border-amber-800/60 text-amber-300 rounded-xl px-4 py-3 text-xs">
        ⚠️ {t('jy_warning')}
      </div>

      <Panel title={t('jy_the_crusher')} icon="🗜️" bodyClassName="p-0">
        {cars.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('gr_no_cars')}</div>
        ) : (
          cars.map((car) => (
            <div key={car.id} className="border-t first:border-t-0 border-zinc-800 px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-zinc-800/30">
              <CarImage catalogId={car.catalog_id ?? ''} name={car.name} size={64} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">🚗 {car.name}</div>
                 <div className="text-[11px] text-zinc-500">
                   {t('gr_condition')} {car.condition}% • {t('jy_yields', { bullets: crushBullets })}
                 </div>
              </div>
              <button
                onClick={() => crushCar(car)}
                disabled={busy}
                className="px-4 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-xs font-semibold disabled:opacity-40"
              >
                🗜️ {t('garage_crush_button', { name: car.name })}
              </button>
            </div>
          ))
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">
        {t('jy_footer')} <Link href="/metal-factory" className="text-red-400 hover:underline">🏭 {t('menu_metal_factory')}</Link>
      </div>
    </div>
  );
}
