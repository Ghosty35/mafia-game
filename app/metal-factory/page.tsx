'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MetalFactoryPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pricePerBullet = 5; // sharp price

  const buyBullets = async () => {
    if (!player) return;

    setBusy(true);
    const supabase = createClient();

    // Purchase + police risk are enforced server-side (buy_bullets RPC)
    const { data, error } = await supabase.rpc('buy_bullets', { amount });

    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? t('common_not_enough_cash') : (error.message || t('factory_purchase_failed')));
    } else if (data?.busted) {
      await refreshPlayer();
      setMessage(t('factory_busted', { fine: `$${data.fine}` }));
    } else {
      await refreshPlayer();
      setMessage(t('factory_bought', { bullets: data?.bullets_bought || amount, cost: `$${data?.cost || amount * pricePerBullet}` }));
    }

    setBusy(false);
  };

  if (!player) return <div>{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏭 {t('factory_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('factory_desc')}</p>

      {message && <div className="mb-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

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
          {t('factory_cost')} <span className="font-mono">${amount * pricePerBullet}</span> 
          {amount > 5000 && <span className="text-red-400 ml-2">{t('factory_high_risk')}</span>}
        </div>

        <button 
          onClick={buyBullets} 
          disabled={busy}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold"
        >
          {busy ? t('factory_buying') : t('factory_buy')}
        </button>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        {t('factory_current', { bullets: player.bullets || 0 })}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
