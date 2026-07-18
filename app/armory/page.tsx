'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import type { TranslationKey } from '@/lib/i18n/translations';

const powerPacks: { power: number; price: number; labelKey: TranslationKey }[] = [
  { power: 50, price: 1200, labelKey: 'armory_pack_basic' },
  { power: 150, price: 3500, labelKey: 'armory_pack_street' },
  { power: 400, price: 8500, labelKey: 'armory_pack_heavy' },
  { power: 1000, price: 18000, labelKey: 'armory_pack_warlord' },
];

// Visual reference point for the power meter only — buying is uncapped.
const POWER_DISPLAY_REF = 10000;

export default function ArmoryPage() {
  const { t, fm } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const currentPower = player?.power ?? 0;

  const buyPower = async (power: number, price: number) => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    const { error } = await supabase.rpc('buy_power', {
      power_amount: power,
      cost: price,
    });

    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) {
        setMessage(t('common_not_enough_cash'));
      } else {
        setMessage(t('armory_purchase_failed'));
      }
    } else {
      setMessage(t('armory_bought', { power, price: fm(price) }));
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🔫 {t('armory_title')}</h1>
        <p className="text-sm text-zinc-400">{t('armory_desc')}</p>
      </div>

      {/* Power meter (uncapped — more power is better) */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-zinc-400">{t('armory_your_power')}</span>
          <span className="font-mono text-sm text-orange-400">
            {currentPower.toLocaleString()}
          </span>
        </div>
        <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-600 to-amber-400 transition-all"
            style={{ width: `${Math.min(100, (currentPower / POWER_DISPLAY_REF) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-2">{t('armory_no_cap')}</p>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {powerPacks.map((pack, i) => (
          <div key={i} className="card p-5 flex flex-col">
            <div className="text-3xl mb-2">⚔️</div>
            <h3 className="font-bold text-lg mb-1">{t(pack.labelKey)}</h3>
            <div className="text-emerald-400 font-mono mb-4">
              {t('armory_power', { power: pack.power })}
            </div>
            <div className="mt-auto flex justify-between items-center">
              <span className="text-lg font-mono">{fm(pack.price)}</span>
              <button
                onClick={() => buyPower(pack.power, pack.price)}
                disabled={busy}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('armory_buy')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-xs text-zinc-500">{t('armory_footer')}</div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
