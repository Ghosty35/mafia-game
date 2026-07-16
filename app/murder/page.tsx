'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const WEAPONS: { name: string; labelKey: TranslationKey; descKey: TranslationKey; price: number; bonus: number }[] = [
  { name: 'Pistol', labelKey: 'murder_weapon_pistol', descKey: 'murder_weapon_pistol_desc', price: 200, bonus: 5 },
  { name: 'SMG', labelKey: 'murder_weapon_smg', descKey: 'murder_weapon_smg_desc', price: 800, bonus: 15 },
  { name: 'Rifle', labelKey: 'murder_weapon_rifle', descKey: 'murder_weapon_rifle_desc', price: 2500, bonus: 30 },
];

export default function MurderPage() {
  const { player, updatePlayer, showToast } = usePlayer();
  const { t } = useLanguage();
  const [targetName, setTargetName] = useState('');
  const [selectedWeapon, setSelectedWeapon] = useState(WEAPONS[0].name);
  const [bulletsUsed, setBulletsUsed] = useState(50);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds left

  // Cooldown timer - MUST be declared before any early returns (Rules of Hooks)
  useEffect(() => {
    if (!player?.murder_cooldown) {
      setCooldown(0);
      return;
    }
    const end = new Date(player.murder_cooldown).getTime();
    const tick = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setCooldown(left);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [player?.murder_cooldown]);

  if (!player) return <div className="p-8">{t('loading')}</div>;

  const hitmanLevel = 16;
  const murderSkillPercent = Math.min(100, Math.floor((player.murder_skill || 0) * 5));
  const isUnlocked = player.level >= hitmanLevel && murderSkillPercent >= 50;
  const canCleanHit = murderSkillPercent >= 75;

  const currentWeapon = WEAPONS.find(w => w.name === selectedWeapon)!;
  const totalCost = currentWeapon.price;

  const attemptMurder = async () => {
    if (!isUnlocked) {
      alert(t('murder_locked_alert'));
      return;
    }
    if (!targetName.trim() || bulletsUsed < 10 || bulletsUsed > 500 || (player.bullets || 0) < bulletsUsed) {
      alert(t('murder_invalid_input'));
      return;
    }

    setBusy(true);

    try {
      const supabase = createClient();

      const { data, error } = await supabase.rpc('attempt_murder', {
        target_username: targetName,
        weapon: selectedWeapon,
        bullets_used: bulletsUsed
      });

      if (error) {
        let text = error.message;
        if (error.message.includes('ON_MURDER_COOLDOWN')) text = t('murder_on_cooldown');
        else if (error.message.includes('MURDER_LOCKED')) text = t('murder_locked_alert');
        else if (error.message.includes('TARGET_NOT_FOUND')) text = t('murder_invalid_input');
        else if (error.message.includes('NOT_ENOUGH_STAMINA')) text = t('error_no_stamina');
        showToast(text, 'error');
      } else {
        updatePlayer(data.player);
        const message = data.success
          ? `Hit successful! Stole $${(data.stolen || 0).toLocaleString()} and gained ${data.skill_gained} KillSkill.`
          : `The hit failed — target got away. Heat increased.`;
        showToast(message, data.success ? 'success' : 'fail');
      }
    } catch (e: any) {
      showToast(e.message || t('common_error'), 'error');
    }

    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🔫 {t('murder_title')}</h1>
      {!isUnlocked && (
        <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-sm">
          {t('murder_locked_banner', { level: player.level, skill: murderSkillPercent })}
        </div>
      )}
      {isUnlocked && !canCleanHit && (
        <div className="mb-4 p-3 bg-yellow-950 border border-yellow-800 rounded text-sm">
          {t('murder_low_skill_banner')}
        </div>
      )}
      <p className="text-sm text-zinc-400 mb-6">{t('murder_desc')}</p>
      {cooldown > 0 && (
        <div className="mb-4 p-2 bg-orange-900 text-orange-200 rounded text-sm">
          {t('murder_cooldown', { minutes: Math.floor(cooldown / 60), seconds: cooldown % 60 })}
        </div>
      )}

      <div className="card p-6 mb-6">
        <div className="mb-4">
          <label className="block text-sm mb-1">{t('murder_target_label')}</label>
          <input 
            type="text" 
            value={targetName} 
            onChange={e => setTargetName(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-2"
            placeholder={t('murder_target_placeholder')}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">{t('murder_weapon_label')}</label>
          <div className="flex gap-2">
            {WEAPONS.map(w => (
              <button 
                key={w.name}
                onClick={() => setSelectedWeapon(w.name)}
                className={`flex-1 p-3 rounded text-sm ${selectedWeapon === w.name ? 'bg-red-700' : 'bg-zinc-800'}`}
              >
                {t(w.labelKey)} (+{w.bonus}%)<br />
                <span className="text-xs">${w.price}</span>
              </button>
            ))}
          </div>
          <p className="text-xs mt-1 text-zinc-500">{t(currentWeapon.descKey)}</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">{t('murder_bullets_label')}</label>
          <input 
            type="range" 
            min="0" 
            max="500" 
            value={bulletsUsed} 
            onChange={e => setBulletsUsed(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs">
            <span>0</span>
            <span className="font-mono">{bulletsUsed}</span>
            <span>500</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">{t('murder_current_bullets', { bullets: player.bullets || 0 })}</p>
        </div>

        <button 
          onClick={attemptMurder} 
          disabled={busy || !targetName.trim() || !isUnlocked || bulletsUsed < 10 || cooldown > 0}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold disabled:opacity-50"
        >
          {busy ? t('murder_attempting') : cooldown > 0 ? t('murder_on_cooldown') : !isUnlocked ? t('murder_locked_button') : t('murder_attempt_button', { weapon: t(currentWeapon.labelKey), bullets: bulletsUsed })}
        </button>
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
