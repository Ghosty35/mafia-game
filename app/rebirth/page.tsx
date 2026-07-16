'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';
import { GODFATHER_LEVEL } from '@/lib/ranks';
import RebirthPanel from '../dashboard/RebirthPanel';
import type { TranslationKey } from '@/lib/i18n/translations';

const INFO_CARDS: Array<{ icon: string; titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { icon: '❓', titleKey: 'rb_what_title', bodyKey: 'rb_what_body' },
  { icon: '🎯', titleKey: 'rb_how_title', bodyKey: 'rb_how_body' },
  { icon: '👑', titleKey: 'rb_bonus_title', bodyKey: 'rb_bonus_body' },
  { icon: '🔄', titleKey: 'rb_reset_title', bodyKey: 'rb_reset_body' },
  { icon: '💼', titleKey: 'rb_keep_title', bodyKey: 'rb_keep_body' },
];

export default function RebirthPage() {
  const { t } = useLanguage();
  const { player, updatePlayer } = usePlayer();
  const [rebornMessage, setRebornMessage] = useState<string | null>(null);

  const rebirths = player?.rebirths ?? 0;
  const level = player?.level ?? 1;
  const eligible = level >= GODFATHER_LEVEL;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">👑 {t('rebirth_title')}</h1>
        <p className="text-xs text-zinc-400">{t('rb_page_desc')}</p>
      </div>

      {/* Current status */}
      <div className="card p-4 bg-zinc-900 border border-yellow-900/50 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          {t('rb_current_count')}:{' '}
          <span className="font-mono text-yellow-400 font-bold">{rebirths}</span>
        </span>
        <span>
          {t('rb_current_bonus')}:{' '}
          <span className="font-mono text-emerald-400 font-bold">+{rebirths * 50}%</span>
        </span>
        <span>
          {t('rb_current_cd')}:{' '}
          <span className="font-mono text-emerald-400 font-bold">
            -{Math.min(rebirths * 10, 50)}%
          </span>
        </span>
        {!eligible && (
          <span className="text-zinc-400">
            {t('rb_progress', { level, needed: GODFATHER_LEVEL })}
          </span>
        )}
      </div>

      {rebornMessage && (
        <div className="card p-4 bg-yellow-950/50 border border-yellow-700 text-yellow-200 text-sm font-semibold">
          {rebornMessage}
        </div>
      )}

      {/* The actual rebirth action (only at Godfather) */}
      {eligible && player && (
        <RebirthPanel player={player} onPlayerUpdate={updatePlayer} onReborn={setRebornMessage} />
      )}

      {/* Info cards */}
      <div className="grid sm:grid-cols-2 gap-3">
        {INFO_CARDS.map((c) => (
          <div key={c.titleKey} className="card p-4 bg-zinc-900 border border-zinc-700">
            <h2 className="font-semibold text-sm mb-1">
              {c.icon} {t(c.titleKey)}
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">{t(c.bodyKey)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
