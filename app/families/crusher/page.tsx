'use client';
import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../../components/Panel';

type Crusher = {
  in_family: boolean;
  family_name?: string;
  can_manage?: boolean;
  tier?: number;
  type_name?: string | null;
  per_car?: number;
  max_cars?: number;
  cars_crushed?: number;
  armoury_cap?: number;
  bullets?: number;
  upgrade_cost?: number | null;
  next_name?: string | null;
  family_bank?: number;
  my_cars?: Array<{ id: string; name: string; condition: number; value: number }>;
  members?: Array<{ username: string }>;
};

export const dynamic = 'force-dynamic';

// Family Auto Crusher (083): members feed cars in, the family armoury fills
// up, leadership hands bullets back out.
export default function CrusherPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();

  const [data, setData] = useState<Crusher | null>(null);
  const [carId, setCarId] = useState('');
  const [giveTo, setGiveTo] = useState('');
  const [giveAmount, setGiveAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const supabase = createClient();

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc('get_family_crusher');
    if (d) {
      setData(d as Crusher);
      setCarId((prev) => prev || d.my_cars?.[0]?.id || '');
      setGiveTo((prev) => prev || d.members?.[0]?.username || '');
    }
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  const fail = (m: string) => {
    const map: Record<string, TranslationKey> = {
      NO_CRUSHER: 'cr_err_none',
      CRUSHER_WORN_OUT: 'cr_err_worn',
      ARMOURY_FULL: 'cr_err_armoury_full',
      CAR_ON_AUCTION: 'cr_err_on_auction',
      NOT_AUTHORIZED: 'cr_err_not_authorized',
      NOT_ENOUGH_BANK: 'cr_err_bank',
      NOT_ENOUGH_BULLETS: 'cr_err_bullets',
      NOT_A_MEMBER: 'cr_err_not_member',
      TARGET_NOT_FOUND: 'dt_err_not_found',
      MAX_TIER: 'cr_err_max_tier',
      IN_JAIL: 'error_in_jail',
    };
    const hit = Object.keys(map).find((k) => m.includes(k));
    setError(t(hit ? map[hit] : 'garage_action_failed'));
  };

  const run = async (fn: string, args: Record<string, unknown>, ok: (d: any) => string) => {
    setBusy(true);
    setError('');
    setMessage('');
    const { data: res, error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    if (err) return fail(err.message || '');
    setMessage(ok(res));
    await refreshPlayer();
    await router.refresh();
    await load();
  };

  if (!player || !data) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  if (!data.in_family) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('cr_title')} icon="🗜️">
          <p className="text-sm text-zinc-300 mb-4">{t('fam_none_text')}</p>
          <Link href="/families/join" className="inline-block px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            {t('fam_none_join')}
          </Link>
        </Panel>
      </div>
    );
  }

  const hasCrusher = (data.tier ?? 0) > 0;
  const wearPct = data.max_cars ? Math.min(100, ((data.cars_crushed ?? 0) / data.max_cars) * 100) : 0;
  const armouryPct = data.armoury_cap ? Math.min(100, ((data.bullets ?? 0) / data.armoury_cap) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🗜️ {t('cr_title')}</h1>
          <p className="text-xs text-zinc-400">{t('cr_subtitle', { family: data.family_name ?? '' })}</p>
        </div>
        <Link href="/families" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs">👥 {t('menu_my_family')}</Link>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {message && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{message}</div>}

      {!hasCrusher ? (
        <Panel title={t('cr_none_title')} icon="🏭">
          <p className="text-sm text-zinc-300 mb-3">{t('cr_none_text')}</p>
          {data.can_manage ? (
            <>
              <div className="text-xs text-zinc-400 mb-3">
                {t('cr_buy_cost', { cost: fm(data.upgrade_cost ?? 0), bank: fm(data.family_bank ?? 0) })}
              </div>
              <button
                onClick={() => run('family_upgrade_crusher', {}, (d) => t('cr_installed', { name: d.name, cost: fm(d.cost) }))}
                disabled={busy || (data.family_bank ?? 0) < (data.upgrade_cost ?? 0)}
                className="px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                🏭 {t('cr_buy_button')}
              </button>
            </>
          ) : (
            <p className="text-xs text-zinc-500">{t('cr_leadership_only')}</p>
          )}
        </Panel>
      ) : (
        <>
          {/* Machine — mirrors the reference layout */}
          <Panel title={t('cr_machine')} icon="🗜️" bodyClassName="p-0">
            <div className="grid grid-cols-12 px-4 py-2 border-b border-zinc-800 text-sm">
              <div className="col-span-5 text-zinc-500">{t('cr_type')}</div>
              <div className="col-span-7 font-semibold">{data.type_name}</div>
            </div>
            <div className="grid grid-cols-12 px-4 py-2 border-b border-zinc-800 text-sm">
              <div className="col-span-5 text-zinc-500">{t('cr_per_car')}</div>
              <div className="col-span-7 font-mono text-amber-400">{data.per_car} 🔫</div>
            </div>
            <div className="grid grid-cols-12 px-4 py-2 border-b border-zinc-800 text-sm">
              <div className="col-span-5 text-zinc-500">{t('cr_max_cars')}</div>
              <div className="col-span-7 font-mono">{data.max_cars?.toLocaleString()}</div>
            </div>
            <div className="px-4 py-2.5">
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>{t('cr_converted')}</span>
                <span className="font-mono">{data.cars_crushed?.toLocaleString()} / {data.max_cars?.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${wearPct > 90 ? 'bg-red-600' : 'bg-amber-500'}`} style={{ width: `${wearPct}%` }} />
              </div>
            </div>
          </Panel>

          {/* Armoury */}
          <Panel title={t('cr_armoury')} icon="🔫">
            <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
              <span>{t('cr_stock')}</span>
              <span className="font-mono">{data.bullets?.toLocaleString()} / {data.armoury_cap?.toLocaleString()}</span>
            </div>
            <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full ${armouryPct >= 100 ? 'bg-red-600' : 'bg-emerald-500'}`} style={{ width: `${armouryPct}%` }} />
            </div>
            {armouryPct >= 100 && <p className="text-[11px] text-red-400">{t('cr_armoury_full_note')}</p>}
          </Panel>

          {/* Feed the crusher */}
          <Panel title={t('cr_feed_title')} icon="🚗">
            <p className="text-xs text-zinc-400 mb-3">{t('cr_feed_text', { count: data.per_car ?? 0 })}</p>
            {(data.my_cars?.length ?? 0) === 0 ? (
              <p className="text-sm text-zinc-500">
                {t('gr_no_cars')} <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select
                  value={carId}
                  onChange={(e) => setCarId(e.target.value)}
                  className="flex-1 min-w-48 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {data.my_cars!.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.condition}% — {t('jy_resale', { price: fm(c.value) })}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const car = data.my_cars!.find((c) => c.id === carId);
                    if (!car) return;
                    if (!confirm(t('cr_confirm', { name: car.name, count: data.per_car ?? 0, price: fm(car.value) }))) return;
                    run('family_crush_car', { p_car_id: carId }, (d) => t('cr_crushed', { car: d.car, count: d.bullets_gained }));
                  }}
                  disabled={busy || !carId}
                  className="px-4 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm font-semibold disabled:opacity-40"
                >
                  🗜️ {t('cr_feed_button')}
                </button>
              </div>
            )}
          </Panel>

          {/* Hand out */}
          {data.can_manage && (
            <Panel title={t('cr_give_title')} icon="📦">
              <p className="text-xs text-zinc-400 mb-3">{t('cr_give_text')}</p>
              {(data.members?.length ?? 0) === 0 ? (
                <p className="text-sm text-zinc-500">{t('cr_no_members')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select
                    value={giveTo}
                    onChange={(e) => setGiveTo(e.target.value)}
                    className="flex-1 min-w-40 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  >
                    {data.members!.map((m) => (
                      <option key={m.username} value={m.username}>{m.username}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={giveAmount}
                    min={1}
                    max={data.bullets ?? 0}
                    onChange={(e) => setGiveAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 w-28 text-sm font-mono"
                  />
                  <button
                    onClick={() => run('family_give_bullets', { p_username: giveTo, p_amount: giveAmount }, (d) => t('cr_given', { count: d.amount, name: d.to }))}
                    disabled={busy || !giveTo || (data.bullets ?? 0) < giveAmount}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold disabled:opacity-40"
                  >
                    📦 {t('cr_give_button')}
                  </button>
                </div>
              )}
            </Panel>
          )}

          {/* Upgrade */}
          {data.can_manage && (data.tier ?? 0) < 3 && (
            <Panel title={t('cr_upgrade_title')} icon="⬆️">
              <p className="text-xs text-zinc-400 mb-3">
                {t('cr_upgrade_text', { next: data.next_name ?? '', cost: fm(data.upgrade_cost ?? 0), bank: fm(data.family_bank ?? 0) })}
              </p>
              <button
                onClick={() => run('family_upgrade_crusher', {}, (d) => t('cr_installed', { name: d.name, cost: fm(d.cost) }))}
                disabled={busy || (data.family_bank ?? 0) < (data.upgrade_cost ?? 0)}
                className="px-4 py-2 bg-blue-800 hover:bg-blue-700 rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                ⬆️ {t('cr_upgrade_button', { next: data.next_name ?? '' })}
              </button>
              <p className="text-[11px] text-zinc-500 mt-2">{t('cr_upgrade_note')}</p>
            </Panel>
          )}
        </>
      )}

      <div className="text-[11px] text-zinc-500">{t('cr_footer')}</div>
    </div>
  );
}
