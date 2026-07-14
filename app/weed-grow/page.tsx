'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function WeedGrowPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const [weedProgress, setWeedProgress] = useState(0);
  const [harvestPercent, setHarvestPercent] = useState(100);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const owned = player?.owned_properties || [];
  const hasHouse = owned.some((p: any) => p.name && (p.name.toLowerCase().includes('house') || p.name.toLowerCase().includes('villa') || p.name.toLowerCase().includes('mansion')));
  const hasVilla = owned.some((p: any) => p.name && p.name.toLowerCase().includes('villa'));
  const hasMansion = owned.some((p: any) => p.name && p.name.toLowerCase().includes('mansion'));

  useEffect(() => {
    if (player?.weed_progress !== undefined) setWeedProgress(player.weed_progress);
    // Quality % persists in the weed_plants jsonb column
    const quality = (player?.weed_plants as any)?.quality;
    if (typeof quality === 'number') setHarvestPercent(quality);
  }, [player]);

  const waterPlant = async () => {
    if (!player || !hasHouse || busy) return;
    if (weedProgress >= 5) {
      setMessage(t('weed_max_progress'));
      return;
    }
    setBusy(true);
    // Simulate water: 70% success +15%, 30% fail -10%
    const success = Math.random() > 0.3;
    const change = success ? 15 : -10;
    const newPercent = Math.max(-50, Math.min(200, harvestPercent + change));
    const newProgress = Math.min(5, weedProgress + 1);

    const supabase = createClient();
    const { error } = await supabase.rpc('apply_action', {
      cash_delta: 0,
      patch: { weed_progress: newProgress, weed_plants: { quality: newPercent } },
    });
    if (error) {
      setMessage(error.message || t('weed_water_save_failed'));
      setBusy(false);
      return;
    }

    setHarvestPercent(newPercent);
    setWeedProgress(newProgress);
    if (refreshPlayer) await refreshPlayer();

    setMessage(success
      ? t('weed_water_success', { change, percent: newPercent })
      : t('weed_water_fail', { change: Math.abs(change), percent: newPercent }));

    setBusy(false);
  };

  const WEED_CAP = 1000;
  const harvest = async () => {
    if (!player || weedProgress < 4) {
      setMessage(t('weed_need_progress'));
      return;
    }
    const kgBase = hasMansion ? 250 : hasVilla ? 120 : 40;
    const qualityMult = Math.max(0.1, harvestPercent / 100);
    const kg = Math.floor(kgBase * qualityMult);

    const current = player.drug_storage?.Weed || 0;
    if (current + kg > WEED_CAP) {
      setMessage(t('weed_cap_reached', { cap: WEED_CAP }));
      return;
    }

    const supabase = createClient();

    if (harvestPercent < 0) {
      const { error } = await supabase.rpc('apply_action', {
        cash_delta: 0,
        patch: {
          weed_progress: 0,
          weed_plants: { quality: 100 },
          failed_harvest_kg: (player.failed_harvest_kg || 0) + kgBase,
        },
      });
      if (error) { setMessage(error.message || t('weed_save_failed')); return; }
      setMessage(t('weed_destroyed'));
      setWeedProgress(0);
      setHarvestPercent(100);
      if (refreshPlayer) await refreshPlayer();
      return;
    }

    const storage = player.drug_storage || {};
    const newStorage = { ...storage, Weed: (storage.Weed || 0) + kg };

    const { error } = await supabase.rpc('apply_action', {
      cash_delta: 0,
      patch: {
        weed_progress: 0,
        drug_storage: newStorage,
        weed_plants: { quality: 100 },
        successful_harvest_kg: (player.successful_harvest_kg || 0) + kg,
      },
    });
    if (error) { setMessage(error.message || t('weed_harvest_save_failed')); return; }

    setWeedProgress(0);
    setHarvestPercent(100);
    if (refreshPlayer) await refreshPlayer();

    setMessage(t('weed_harvested', { kg, percent: harvestPercent }));
  };

  if (!player) return <div className="p-8">{t('loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🌱 {t('weed_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('weed_desc')}</p>

      {!hasHouse && <p className="text-amber-400">{t('weed_locked')}</p>}

      {hasHouse && (
        <div className="card p-6">
          <div className="mb-4">
            <div>{t('weed_progress', { progress: weedProgress })}</div>
            <div className="w-full bg-zinc-800 h-3 rounded mt-1">
              <div className="bg-emerald-600 h-3 rounded" style={{width: `${(weedProgress/5)*100}%`}} />
            </div>
            <div className="mt-2 text-lg">{t('weed_quality')} <span className={harvestPercent < 0 ? 'text-red-500' : 'text-emerald-400'}>{harvestPercent}%</span></div>
          </div>

          <div className="flex gap-3 mb-4">
            <button onClick={waterPlant} disabled={busy || weedProgress >=5} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              {t('weed_water_button')}
            </button>
            <button onClick={harvest} disabled={weedProgress < 4} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              {t('weed_harvest_button')}
            </button>
          </div>

          <p className="text-xs text-zinc-500">{t('weed_water_note')}</p>
        </div>
      )}

      {message && <div className="mt-4 p-3 bg-zinc-900 rounded">{message}</div>}

      <Link href="/street-dealer" className="mt-6 inline-block text-sm text-red-400">{t('weed_back')}</Link>
    </div>
  );
}
