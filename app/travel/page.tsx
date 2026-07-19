'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { streetEventText } from '@/lib/streetEvents';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import Panel from '../components/Panel';
import CityImage from '../components/CityImage';

type Destination = {
  city: string;
  km: number;
  train_cost: number;
  plane_cost: number;
  litres_needed: number;
};

type TravelCar = {
  id: string;
  name: string;
  condition: number;
  fuel: number;
  fuel_tank: number;
  range_km: number;
};

type TravelInfo = {
  current_city: string;
  travel_cooldown: string | null;
  train_cost: number;
  fuel_price: number | null;
  destinations: Destination[];
  cars: TravelCar[];
};

type Mode = 'train' | 'car' | 'plane';

export const dynamic = 'force-dynamic';

// Travel (075): three modes with real trade-offs — train is cheap but has a
// 3 min cooldown, the car burns fuel and wears down, the plane costs cash.
export default function TravelPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language, fm } = useLanguage();
  const router = useRouter();

  const [info, setInfo] = useState<TravelInfo | null>(null);
  const [mode, setMode] = useState<Mode>('train');
  const [carId, setCarId] = useState('');
  const [bribe, setBribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // How much product you're carrying — drives the smuggling risk (139).
  const carriedKg = Object.values(player?.drug_storage ?? {}).reduce((a, b) => a + Number(b || 0), 0);

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_travel_info');
    if (data) {
      setInfo(data as TravelInfo);
      setCarId((prev) => prev || (data.cars?.[0]?.id ?? ''));
    }
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  // Drives the train-cooldown countdown.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const cooldownLeft = info?.travel_cooldown
    ? Math.max(0, Math.ceil((new Date(info.travel_cooldown).getTime() - now) / 1000))
    : 0;

  const selectedCar = info?.cars.find((c) => c.id === carId) ?? null;

  const errorText = (raw: string) => {
    if (raw.includes('NOT_ENOUGH_CASH')) return t('travel_no_cash');
    if (raw.includes('IN_JAIL')) return t('error_in_jail');
    if (raw.includes('DEAD')) return t('travel_dead');
    if (raw.includes('ON_COOLDOWN')) return t('tv_err_cooldown');
    if (raw.includes('NOT_ENOUGH_FUEL')) return t('tv_err_fuel');
    if (raw.includes('CAR_TOO_DAMAGED')) return t('tv_err_damaged');
    if (raw.includes('CAR_NOT_FOUND')) return t('tv_err_no_car');
    if (raw.includes('ALREADY_THERE')) return t('tv_err_already');
    if (raw.includes('NOT_ENOUGH_CASH_BRIBE')) return t('tv_err_bribe_cash');
    if (raw.includes('UNKNOWN_CITY')) return t('tv_err_unknown_city');
    return t('travel_failed');
  };

  const travel = async (dest: Destination) => {
    setBusy(true);
    setMessage('');

    const call =
      mode === 'train'
        ? supabase.rpc('travel_to_city', { city: dest.city, p_bribe: bribe })
        : mode === 'car'
          ? supabase.rpc('travel_by_car', { p_city: dest.city, p_car_id: carId, p_bribe: bribe })
          : supabase.rpc('travel_by_plane', { p_city: dest.city, p_bribe: bribe });

    const { data, error } = await call;
    setBusy(false);

    if (error) {
      setMessage(errorText(error.message || ''));
      return;
    }

    await refreshPlayer();
    await load();
    await router.refresh();

    let text =
      data.mode === 'car'
        ? t('tv_done_car', { city: dest.city, litres: data.litres_used, wear: data.wear })
        : t('tv_done_paid', {
            city: dest.city,
            cost: fm(data.cost ?? 0),
            mode: t(data.mode === 'plane' ? 'tv_mode_plane' : 'tv_mode_train'),
          });

    // Smuggling outcome (139) — only when you were actually carrying.
    const sm = data.smuggle;
    if (sm && sm.carried > 0) {
      if (sm.busted && sm.bribed) text += ` ${t('tv_smuggle_bribe_busted', { fee: fm(sm.bribe_fee ?? 0) })}`;
      else if (sm.busted) text += ` ${t('tv_smuggle_busted')}`;
      else if (sm.bribed) text += ` ${t('tv_smuggle_bribed_safe', { fee: fm(sm.bribe_fee ?? 0) })}`;
      else text += ` ${t('tv_smuggle_safe')}`;
    }

    const evText = streetEventText(data?.event, t, language);
    if (evText) text += ` ${evText}`;
    setMessage(text);
  };

  if (!player || !info) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  const modes: Array<{ key: Mode; icon: string; label: string; hint: string }> = [
    { key: 'train', icon: '🚂', label: t('tv_mode_train'), hint: t('tv_train_hint', { cost: fm(info.train_cost) }) },
    { key: 'car', icon: '🚗', label: t('tv_mode_car'), hint: t('tv_car_hint') },
    { key: 'plane', icon: '✈️', label: t('tv_mode_plane'), hint: t('tv_plane_hint') },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🧭 {t('tv_title')}</h1>
          <p className="text-xs text-zinc-400">
            {t('travel_current_location')} <strong className="text-white">{info.current_city}</strong>
            {info.fuel_price != null && (
              <span className="ml-2 text-zinc-500">• {t('tv_fuel_price_here', { price: fm(info.fuel_price) })}</span>
            )}
          </p>
        </div>
        {cooldownLeft > 0 && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('tv_train_cooldown')}</div>
            <div className="font-mono text-amber-400 tabular-nums">{cooldownLeft}s</div>
          </div>
        )}
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* Mode picker */}
      <div className="grid grid-cols-3 gap-2">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-3 py-3 rounded-xl border text-left transition ${
              mode === m.key
                ? 'bg-red-900/40 border-red-700'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <div className="text-xl">{m.icon}</div>
            <div className="font-bold text-sm mt-0.5">{m.label}</div>
            <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">{m.hint}</div>
          </button>
        ))}
      </div>

      {/* Car picker — only relevant in car mode */}
      {mode === 'car' && (
        <Panel title={t('tv_your_car')} icon="🚗">
          {info.cars.length === 0 ? (
            <p className="text-sm text-zinc-400">
              {t('tv_no_cars')} <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
            </p>
          ) : (
            <div className="space-y-3">
              <select
                value={carId}
                onChange={(e) => setCarId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                {info.cars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.fuel}/{c.fuel_tank}L • {c.condition}%
                  </option>
                ))}
              </select>

              {selectedCar && (
                <div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span>⛽ {t('tv_fuel')}: {selectedCar.fuel}/{selectedCar.fuel_tank}L</span>
                    <span>{t('tv_range', { km: selectedCar.range_km.toLocaleString() })}</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedCar.fuel / selectedCar.fuel_tank < 0.25 ? 'bg-red-600' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${(selectedCar.fuel / selectedCar.fuel_tank) * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    {t('tv_refuel_hint')}{' '}
                    <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
                  </p>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* Smuggling risk — only when carrying drugs (139) */}
      {carriedKg > 0 && (
        <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl px-4 py-3 space-y-2">
          <div className="text-sm text-amber-300 font-semibold">
            🚨 {t('tv_smuggle_warning', { kg: carriedKg })}
          </div>
          <p className="text-[11px] text-zinc-400">{t('tv_smuggle_hint')}</p>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={bribe} onChange={(e) => setBribe(e.target.checked)} className="accent-amber-600" />
            <span>{t('tv_smuggle_bribe')}</span>
          </label>
        </div>
      )}

      {/* Destinations */}
      <Panel title={t('tv_destinations')} icon="🗺️" bodyClassName="p-0">
        {info.destinations.map((d) => {
          const enoughFuel = selectedCar ? selectedCar.fuel >= d.litres_needed : false;
          const carUnusable = mode === 'car' && (!selectedCar || !enoughFuel || selectedCar.condition < 25);
          const trainBlocked = mode === 'train' && cooldownLeft > 0;
          const price =
            mode === 'train' ? fm(d.train_cost) : mode === 'plane' ? fm(d.plane_cost) : `${d.litres_needed}L`;

          return (
            <div key={d.city} className="border-t first:border-t-0 border-zinc-800 px-4 py-3 hover:bg-zinc-800/30">
               <div className="flex items-center gap-3 flex-wrap">
                 <div className="shrink-0">
                   <CityImage city={d.city} size={64} />
                 </div>
                 <div className="min-w-0 flex-1">
                   <div className="font-semibold">🏙️ {d.city}</div>
                   <div className="text-[11px] text-zinc-500">{d.km.toLocaleString()} km</div>
                 </div>

                 <div className="text-right w-28">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('tv_col_price')}</div>
                  <div className={`font-mono tabular-nums text-sm ${mode === 'car' && !enoughFuel ? 'text-red-400' : 'text-emerald-400'}`}>
                    {price}
                  </div>
                  {mode === 'car' && selectedCar && (
                    <div className="text-[10px] text-zinc-500">
                      {enoughFuel ? t('tv_fuel_ok', { left: selectedCar.fuel - d.litres_needed }) : t('tv_fuel_short', { short: d.litres_needed - selectedCar.fuel })}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => travel(d)}
                  disabled={busy || carUnusable || trainBlocked}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {trainBlocked ? `${cooldownLeft}s` : t('travel_to', { city: d.city })}
                </button>
              </div>
            </div>
          );
        })}
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('tv_footer')}</div>
    </div>
  );
}
