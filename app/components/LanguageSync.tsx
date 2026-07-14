'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Applies the player's saved language preference (players.language, migration
 * 037) once after login. The DB value wins over localStorage on load; after
 * that the switcher writes both, so they stay in sync across devices.
 */
export default function LanguageSync() {
  const { player } = usePlayer();
  const { language, setLanguage } = useLanguage();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    const saved = player?.language;
    if (saved === 'en' || saved === 'nl') {
      applied.current = true;
      if (saved !== language) {
        setLanguage(saved, { persist: false });
      }
    }
  }, [player?.language, language, setLanguage]);

  return null;
}
