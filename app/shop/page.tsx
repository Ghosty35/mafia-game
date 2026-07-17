'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import Panel from '../components/Panel';
import { useEconomy } from '@/lib/economy';

// Normal shop: everyday cash items only. Everything VIP/donator/diamond
// lives in the VIP Store (/shop/vip) per the bug-inspectie split.
export default function ShopPage() {
  const { t, fm } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const router = useRouter();
  const economy = useEconomy();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isDonator = !!player?.is_donator;

  // Donator discount: 25% off normal shop prices (server recomputes anyway)
  const getDiscountedPrice = (base: number) => (isDonator ? Math.floor(base * 0.75) : base);

  const buyProtection = async (points: number, cost: number) => {
    if ((player?.protection ?? 0) >= 50) {
      setMessage('Maximum protection reached (50).');
      return;
    }
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc('buy_protection', {
      protection_points: points,
      cost: getDiscountedPrice(cost),
    });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (error.message.includes('POWER_CAP_REACHED')) setMessage('Maximum protection reached (50).');
      else setMessage(t('shop_buy_failed'));
    } else {
      await refreshPlayer();
      router.refresh();
      setMessage(t('shop_protection_bought', { points }));
    }
    setBusy(false);
  };

  // Live catalog from the server (mirrors migration 044 buy_protection).
  const protectionItems = (economy?.protection ?? [
    { points: 5, cost: 450 },
    { points: 8, cost: 780 },
    { points: 12, cost: 1350 },
  ]).map((p) => ({
    icon: p.points === 5 ? '🛡️' : p.points === 8 ? '🐕' : '💼',
    title: p.points === 5 ? t('shop_armor_title') : p.points === 8 ? t('shop_pitbull_title') : t('shop_bodyguard_title'),
    desc: p.points === 5 ? t('shop_armor_desc') : p.points === 8 ? t('shop_pitbull_desc') : t('shop_bodyguard_desc'),
    points: p.points,
    cost: p.cost,
  }));

  return (
    <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🛒 {t('nav_shop')}</h1>
        <p className="text-xs text-zinc-400">{t('shop_subtitle')}</p>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* VIP store teaser */}
      <Link
        href="/shop/vip"
        className="block bg-gradient-to-r from-amber-950/70 to-zinc-900 border border-amber-800/60 rounded-xl px-5 py-4 hover:border-amber-600 transition"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-bold text-amber-300">👑 {t('menu_vip_store')}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{t('shop_vip_teaser')}</div>
          </div>
          <span className="text-amber-400 text-lg shrink-0">→</span>
        </div>
      </Link>

      {/* Protection */}
      <Panel title={t('shop_protection_title')} icon="🛡️">
        <p className="text-xs text-zinc-400 mb-3">
          {t('shop_protection_desc')}
          {isDonator && <span className="text-amber-400 ml-1">{t('shop_donator_discount')}</span>}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {protectionItems.map((item) => {
            const atProtectionCap = (player?.protection ?? 0) >= 50;
            return (
              <button
                key={item.points}
                onClick={() => buyProtection(item.points, item.cost)}
                disabled={busy || atProtectionCap}
                title={atProtectionCap ? 'Maximum protection reached (50).' : undefined}
                className="card p-5 text-left hover:border-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="text-3xl mb-2">{item.icon}</div>
                <h3 className="font-bold">{item.title}</h3>
                <p className="text-sm text-zinc-400">{item.desc}</p>
                <div className="mt-3 text-emerald-400 font-mono text-sm">
                  {fm(getDiscountedPrice(item.cost))}
                  {isDonator && <span className="text-[10px] text-zinc-500 line-through ml-2">{fm(item.cost)}</span>}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">{t('shop_protection_current', { value: player?.protection ?? 0 })}</p>
      </Panel>

      {/* Personal bodyguards (070): absorb rip/murder attempts */}
      <Panel title={t('bg_title')} icon="💼">
        <p className="text-xs text-zinc-400 mb-3">{t('bg_desc')}</p>
        <BodyguardCard busy={busy} setMessage={setMessage} router={router} />
      </Panel>

      <div className="text-[11px] text-zinc-500 text-center">{t('shop_footer')}</div>
    </main>
  );
}

// Personal bodyguards: each one absorbs an incoming rip/murder attempt.
// Escalating server-side pricing ($50k → $500k), max 5. RPC: hire_personal_bodyguard.
function BodyguardCard({ busy, setMessage, router }: { busy: boolean; setMessage: (m: string) => void; router: ReturnType<typeof useRouter> }) {
  const { t, fm } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const economy = useEconomy();
  const [localBusy, setLocalBusy] = useState(false);

  const guards = player?.bodyguards ?? 0;
  const bodyguardCosts = economy?.bodyguard_costs ?? [50000, 100000, 200000, 350000, 500000];
  const nextCost = guards < (economy?.bodyguard_max ?? 5) ? bodyguardCosts[guards] : null;

  const hire = async () => {
    if (localBusy) return;
    setLocalBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('hire_personal_bodyguard');
      if (error) {
        if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
        else if (error.message.includes('MAX_BODYGUARDS')) setMessage(t('bg_max'));
        else if (error.message.includes('IN_JAIL')) setMessage(t('error_in_jail'));
        else setMessage(error.message);
        return;
      }
      await refreshPlayer();
      router.refresh();
      setMessage(t('bg_hired', { count: data?.bodyguards ?? guards + 1, cost: fm(Number(data?.cost ?? nextCost ?? 0)) }));
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-sm">
          💼 {t('bg_current')}: <span className="font-mono text-amber-400">{guards}/{economy?.bodyguard_max ?? 5}</span>
        </div>
        <div className="text-lg tracking-wide">{'💼'.repeat(guards)}{'▫️'.repeat((economy?.bodyguard_max ?? 5) - guards)}</div>
      </div>
      <p className="text-xs text-zinc-400 mb-3">{t('bg_note')}</p>
      <button
        onClick={hire}
        disabled={busy || localBusy || guards >= (economy?.bodyguard_max ?? 5)}
        className="w-full py-2.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm"
      >
        {guards >= (economy?.bodyguard_max ?? 5) ? t('bg_max') : t('bg_hire', { cost: fm(nextCost ?? 0) })}
      </button>
    </div>
  );
}
