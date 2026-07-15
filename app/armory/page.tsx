'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const powerPacks: { power: number; price: number; labelKey: TranslationKey }[] = [
  { power: 50, price: 1200, labelKey: 'armory_pack_basic' }, // balanced
  { power: 150, price: 3500, labelKey: 'armory_pack_street' },
  { power: 400, price: 8500, labelKey: 'armory_pack_heavy' },
  { power: 1000, price: 18000, labelKey: 'armory_pack_warlord' },
];

export default function ArmoryPage() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const buyPower = async (power: number, price: number) => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    const { error } = await supabase.rpc('buy_power', {
      power_amount: power,
      cost: price,
    });

    if (error) {
      setMessage(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('common_not_enough_cash')
          : t('armory_purchase_failed'),
      );
    } else {
      setMessage(t('armory_bought', { power, price: `$${price}` }));
    }
    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🔫 {t('armory_title')}</h1>
        <p className="text-sm text-zinc-400">{t('armory_desc')}</p>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded text-sm">{message}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {powerPacks.map((pack, i) => (
          <div key={i} className="card p-5">
            <div className="text-3xl mb-2">⚔️</div>
            <h3 className="font-bold text-lg mb-1">{t(pack.labelKey)}</h3>
            <div className="text-emerald-400 font-mono mb-3">
              {t('armory_power', { power: pack.power })}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-lg font-mono">${pack.price}</span>
              <button
                onClick={() => buyPower(pack.power, pack.price)}
                disabled={busy}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold disabled:opacity-50"
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
