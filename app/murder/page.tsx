'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import type { TranslationKey } from '@/lib/i18n/translations';

// Weapon bonus % matches the server's attempt_murder() logic (077_leave_family_bounty.sql):
//   Rifle +20, SMG +10, Pistol (and any other) +0. No weapon is purchased/charged
//   in a murder — weapons are selected, not bought here — so there is no price.
const WEAPONS: { name: string; labelKey: TranslationKey; descKey: TranslationKey; bonus: number }[] = [
  { name: 'Pistol', labelKey: 'murder_weapon_pistol', descKey: 'murder_weapon_pistol_desc', bonus: 0 },
  { name: 'SMG', labelKey: 'murder_weapon_smg', descKey: 'murder_weapon_smg_desc', bonus: 10 },
  { name: 'Rifle', labelKey: 'murder_weapon_rifle', descKey: 'murder_weapon_rifle_desc', bonus: 20 },
];

export default function MurderPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm" />}>
      <MurderContent />
    </Suspense>
  );
}

function MurderContent() {
  const { player, updatePlayer, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  // The detective's "act now" link hands the target over (076).
  const searchParams = useSearchParams();
  const [targetName, setTargetName] = useState(searchParams.get('target') ?? '');
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

  const attemptMurder = async () => {
    if (!isUnlocked) {
      showToast(t('murder_locked_alert'), 'error');
      return;
    }
    if (!targetName.trim() || bulletsUsed < 10 || bulletsUsed > 500 || (player.bullets || 0) < bulletsUsed) {
      showToast(t('murder_invalid_input'), 'error');
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
        // 076: a hit needs fresh intel from the detective, in the right city
        else if (error.message.includes('NO_INTEL')) text = t('murder_no_intel');
        else if (error.message.includes('TARGET_MOVED')) text = t('murder_target_moved');
        else if (error.message.includes('IN_JAIL')) text = t('error_in_jail');
        showToast(text, 'error');
      } else {
        updatePlayer(data.player);
        const message = data.blocked
          ? t('murder_blocked')
          : data.success
            ? `Hit successful! Stole ${fm(data.stolen || 0)} and gained ${data.skill_gained} KillSkill.`
            : `The hit failed — target got away. Heat increased.`;
        showToast(message, data.success ? 'success' : 'fail');
        if (refreshPlayer) await refreshPlayer();
        router.refresh();
      }
    } catch (e: any) {
      showToast(e.message || t('common_error'), 'error');
    }

    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🔫 {t('murder_title')}</h1>
        <p className="text-xs text-zinc-400">{t('murder_desc')}</p>
      </div>

      {!isUnlocked && (
        <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-4 text-sm">
          <div className="font-semibold text-red-400 mb-1">🔒 Locked</div>
          {t('murder_locked_banner', { level: player.level, skill: murderSkillPercent })}
        </div>
      )}
      {isUnlocked && !canCleanHit && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-xl p-4 text-sm">
          <div className="font-semibold text-amber-400 mb-1">⚠️ Low Skill</div>
          {t('murder_low_skill_banner')}
        </div>
      )}

      {/* 076: murder needs a warm detective tip — say so up front. */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 flex items-center gap-2">
        <span>🕵️</span>
        {t('murder_intel_required')}{' '}
        <Link href="/detective" className="text-amber-400 hover:text-amber-300 transition-colors">{t('menu_detective')}</Link>
      </div>

      {cooldown > 0 && (
        <div className="bg-orange-950/40 border border-orange-800/50 rounded-xl p-3 text-sm text-orange-300">
          ⏱ {t('murder_cooldown', { minutes: Math.floor(cooldown / 60), seconds: cooldown % 60 })}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-2">{t('murder_target_label')}</label>
          <input
            type="text"
            value={targetName}
            onChange={e => setTargetName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-amber-700"
            placeholder={t('murder_target_placeholder')}
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-2">{t('murder_weapon_label')}</label>
          <div className="flex gap-2">
            {WEAPONS.map(w => (
              <button
                key={w.name}
                onClick={() => setSelectedWeapon(w.name)}
                className={`flex-1 p-3 rounded-lg text-sm font-semibold transition-all ${
                  selectedWeapon === w.name
                    ? 'bg-red-700 text-white border border-red-600 shadow-[0_0_10px_rgba(220,38,38,0.2)]'
                    : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-600'
                }`}
              >
                {w.name === 'Rifle' && '🎯 '}{w.name === 'SMG' && '🔫 '}{w.name === 'Pistol' && '🔫 '}
                {t(w.labelKey)} (+{w.bonus}%)
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-2">{t(currentWeapon.descKey)}</p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-2">{t('murder_bullets_label')}</label>
          <input
            type="range"
            min="0"
            max="500"
            value={bulletsUsed}
            onChange={e => setBulletsUsed(parseInt(e.target.value))}
            className="w-full accent-red-600"
          />
          <div className="flex justify-between text-xs text-zinc-500 mt-1">
            <span>0</span>
            <span className="font-mono text-red-400 font-bold">{bulletsUsed}</span>
            <span>500</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">{t('murder_current_bullets', { bullets: player.bullets || 0 })}</p>
        </div>

        <button
          onClick={attemptMurder}
          disabled={busy || !targetName.trim() || !isUnlocked || bulletsUsed < 10 || cooldown > 0}
          className="w-full py-3 bg-red-700 hover:bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg font-bold text-sm tracking-wide transition-colors"
        >
          {busy ? t('murder_attempting') : cooldown > 0 ? t('murder_on_cooldown') : !isUnlocked ? t('murder_locked_button') : t('murder_attempt_button', { weapon: t(currentWeapon.labelKey), bullets: bulletsUsed })}
        </button>
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-amber-400 hover:text-amber-300 transition-colors">← {t('common_back')}</Link>
    </div>
  );
}
