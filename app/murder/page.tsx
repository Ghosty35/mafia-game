'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';

// 135: the weapon you fire is the one you carry — bought in the Armory,
// read server-side from players.equipped_weapon. No client weapon choice.
type ArmoryItem = { key: string; kind: string; label: string; power: number };

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
  const [bulletsUsed, setBulletsUsed] = useState(50);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds left
  const [gear, setGear] = useState<{ weapon: ArmoryItem | null; vest: ArmoryItem | null } | null>(null);

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

  // Loadout card: resolve equipped keys to labels via the armory catalog.
  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_armory');
      if (data) {
        const items: ArmoryItem[] = data.items ?? [];
        setGear({
          weapon: items.find((i) => i.key === data.equipped_weapon) ?? null,
          vest: items.find((i) => i.key === data.equipped_vest) ?? null,
        });
      }
    };
    load();
  }, []);

  if (!player) return <div className="p-8">{t('loading')}</div>;

  const hitmanLevel = 16;
  const murderSkillPercent = Math.min(100, Math.floor((player.murder_skill || 0) * 5));
  const isUnlocked = player.level >= hitmanLevel && murderSkillPercent >= 50;
  const canCleanHit = murderSkillPercent >= 75;

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
            ? t('murder_success_toast', { stolen: fm(data.stolen || 0), score: (data.rip_score || 0).toLocaleString() })
            : t('murder_failed_toast');
        showToast(message, data.success ? 'success' : 'fail');
        if (data.bounty?.claimed) {
          showToast(t('murder_bounty_claimed', { amount: fm(data.bounty.amount || 0) }), 'success');
        }
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

        {/* Loadout (read-only): what you carry is what you shoot with. */}
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-2">{t('murder_loadout_label')}</label>
          <div className="flex flex-col sm:flex-row gap-2 text-sm">
            <div className={`flex-1 p-3 rounded-lg border ${gear?.weapon ? 'bg-zinc-800 border-zinc-700' : 'bg-red-950/30 border-red-900/50'}`}>
              🔫 {gear?.weapon
                ? <>{gear.weapon.label} <span className="text-emerald-400 font-mono text-xs">+{gear.weapon.power}</span></>
                : t('murder_no_weapon')}
            </div>
            <div className="flex-1 p-3 rounded-lg border bg-zinc-800 border-zinc-700">
              🦺 {gear?.vest
                ? <>{gear.vest.label} <span className="text-emerald-400 font-mono text-xs">+{gear.vest.power}</span></>
                : t('murder_no_vest')}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            {t('murder_loadout_hint')}{' '}
            <Link href="/armory" className="text-amber-400 hover:text-amber-300 transition-colors">{t('armory_title')}</Link>
          </p>
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
          {busy ? t('murder_attempting') : cooldown > 0 ? t('murder_on_cooldown') : !isUnlocked ? t('murder_locked_button') : t('murder_attempt_button_gear', { bullets: bulletsUsed })}
        </button>
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-amber-400 hover:text-amber-300 transition-colors">← {t('common_back')}</Link>
    </div>
  );
}
