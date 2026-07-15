'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function WeedGrowPage() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t } = useLanguage();
  const [weedProgress, setWeedProgress] = useState(0);
  const [harvestPercent, setHarvestPercent] = useState(100);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds left until next water

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

  // Live countdown from the server-persisted weed_last_watered timestamp
  useEffect(() => {
    const lastWatered = (player as any)?.weed_last_watered;
    if (!lastWatered) {
      setCooldown(0);
      return;
    }
    const readyAt = new Date(lastWatered).getTime() + 60 * 60 * 1000;
    const tick = () => setCooldown(Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [(player as any)?.weed_last_watered]);

  const formatCooldown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const waterPlant = async () => {
    if (!player || !hasHouse || busy) return;
    if (weedProgress >= 5) {
      showToast(t('weed_max_progress'), 'error');
      return;
    }
    if (cooldown > 0) {
      showToast(`You can only water once an hour. Ready in ${formatCooldown(cooldown)}.`, 'error');
      return;
    }
    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('water_weed_plant');
    if (error) {
      const text = error.message.includes('ON_COOLDOWN')
        ? 'You can only water once an hour — come back later.'
        : error.message.includes('MAX_PROGRESS')
          ? t('weed_max_progress')
          : error.message || t('weed_water_save_failed');
      showToast(text, 'error');
      setBusy(false);
      return;
    }

    setHarvestPercent(data.new_percent);
    setWeedProgress(data.new_progress);
    if (refreshPlayer) await refreshPlayer();

    showToast(
      data.success
        ? t('weed_water_success', { change: data.change, percent: data.new_percent })
        : t('weed_water_fail', { change: Math.abs(data.change), percent: data.new_percent }),
      data.success ? 'success' : 'fail',
    );

    setBusy(false);
  };

  const WEED_CAP = 1000;
  const harvest = async () => {
    if (!player || weedProgress < 4) {
      showToast(t('weed_need_progress'), 'error');
      return;
    }
    const kgBase = hasMansion ? 250 : hasVilla ? 120 : 40;
    const qualityMult = Math.max(0.1, harvestPercent / 100);
    const kg = Math.floor(kgBase * qualityMult);

    const current = player.drug_storage?.Weed || 0;
    if (current + kg > WEED_CAP) {
      showToast(t('weed_cap_reached', { cap: WEED_CAP }), 'error');
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
      if (error) { showToast(error.message || t('weed_save_failed'), 'error'); return; }
      showToast(t('weed_destroyed'), 'fail');
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
    if (error) { showToast(error.message || t('weed_harvest_save_failed'), 'error'); return; }

    setWeedProgress(0);
    setHarvestPercent(100);
    if (refreshPlayer) await refreshPlayer();

    showToast(t('weed_harvested', { kg, percent: harvestPercent }), 'success');
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
            <button onClick={waterPlant} disabled={busy || weedProgress >= 5 || cooldown > 0} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              {cooldown > 0 ? `Ready in ${formatCooldown(cooldown)}` : t('weed_water_button')}
            </button>
            <button onClick={harvest} disabled={weedProgress < 4} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-50">
              {t('weed_harvest_button')}
            </button>
          </div>

          <p className="text-xs text-zinc-500">{t('weed_water_note')} Each plant can only be watered once per hour.</p>
        </div>
      )}

      <Link href="/street-dealer" className="mt-6 inline-block text-sm text-red-400">{t('weed_back')}</Link>
    </div>
  );
}
