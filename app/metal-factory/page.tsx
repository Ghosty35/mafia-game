'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';

type FactoryState = {
  stock: number;
  capacity: number;
  unit_price: number;
  refill_per_hour: number;
};

export default function MetalFactoryPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, language, fm } = useLanguage();
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [factory, setFactory] = useState<FactoryState | null>(null);

  const fmt = (n: number) =>
    new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Math.floor(n));

  const loadFactory = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_bullet_factory');
    if (data) setFactory(data as FactoryState);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFactory();
    const poll = setInterval(loadFactory, 15000);
    return () => clearInterval(poll);
  }, []);

  const unitPrice = factory?.unit_price ?? 5;
  const stock = factory?.stock ?? 0;
  const capacity = factory?.capacity ?? 25000;
  const stockPct = Math.max(0, Math.min(100, Math.round((stock / Math.max(1, capacity)) * 100)));

  const buyBullets = async () => {
    if (!player) return;

    setBusy(true);
    const supabase = createClient();

    // Purchase, live stock + scarcity price and police risk are all server-side (buy_bullets RPC)
    const { data, error } = await supabase.rpc('buy_bullets', { amount });

    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (error.message.includes('FACTORY_EMPTY')) setMessage(t('factory_empty'));
      else if (error.message.includes('BULLET_CAP_REACHED')) setMessage(t('factory_bullet_cap'));
      else if (error.message.includes('IN_JAIL')) setMessage(t('error_in_jail'));
      else setMessage(error.message || t('factory_purchase_failed'));
    } else if (data?.busted) {
      await refreshPlayer();
      await router.refresh();
      setMessage(t('factory_busted', { fine: fm(Number(data.fine)) }));
    } else {
      await refreshPlayer();
      await router.refresh();
      const bought = Number(data?.bullets_bought || 0);
      const requested = Number(data?.requested || amount);
      let text = t('factory_bought', {
        bullets: fmt(bought),
        cost: fm(Number(data?.cost || 0)),
      });
      if (bought < requested) text += ` ${t('factory_partial', { bullets: fmt(bought) })}`;
      setMessage(text);
    }

    await loadFactory();
    setBusy(false);
  };

  if (!player) return <div>{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏭 {t('factory_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('factory_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      {/* Live factory stock */}
      <div className="card p-4 mb-4 border border-zinc-700 bg-zinc-900">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-zinc-300">📦 {t('factory_stock')}</span>
          <span className="font-mono text-amber-300">
            {factory ? `${fmt(stock)} / ${fmt(capacity)}` : '…'}
          </span>
        </div>
        <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-2.5 transition-all ${stockPct > 50 ? 'bg-emerald-500' : stockPct > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${stockPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1.5">
          <span>{t('factory_refill_note', { rate: fmt(factory?.refill_per_hour ?? 2500) })}</span>
          <span>
            {t('factory_unit_price')}: <span className="font-mono text-emerald-400">{fm(unitPrice)}</span>
          </span>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4">
          <label className="block text-sm mb-1">{t('factory_amount_label')}</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(Math.max(10, parseInt(e.target.value) || 10))}
            className="bg-zinc-900 border border-zinc-700 rounded px-4 py-2 w-full"
          />
        </div>

        <div className="text-sm mb-4">
          {t('factory_cost')} <span className="font-mono">{fm(Math.min(amount, stock) * unitPrice)}</span>
          {amount > 5000 && <span className="text-red-400 ml-2">{t('factory_high_risk')}</span>}
          {factory && amount > stock && (
            <span className="text-orange-400 ml-2">{t('factory_low_stock', { stock: fmt(stock) })}</span>
          )}
        </div>

        <button
          onClick={buyBullets}
          disabled={busy || stock <= 0}
          className="w-full py-3 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded font-bold"
        >
          {busy ? t('factory_buying') : stock <= 0 ? t('factory_empty_btn') : t('factory_buy')}
        </button>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        {t('factory_current', { bullets: player.bullets || 0 })}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
