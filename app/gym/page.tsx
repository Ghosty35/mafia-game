'use client';

import GymBoard from '../components/GymBoard';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function GymPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">🏋️ {t('gym_title')}</h1>
        <p className="text-xs text-zinc-400">{t('gym_desc')}</p>
      </div>
      <GymBoard />
    </div>
  );
}
