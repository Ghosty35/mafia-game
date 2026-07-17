'use client';

import Link from 'next/link';
import TerritoryBoard from '../components/TerritoryBoard';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function TerritoriesPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">🗺️ {t('tw_title')}</h1>
        <p className="text-xs text-zinc-400">{t('tw_page_desc')}</p>
      </div>

      <TerritoryBoard />

      <div className="mt-6 text-center">
        <Link href="/families" className="text-xs text-red-400 hover:underline">
          {t('tw_back_to_family')}
        </Link>
      </div>
    </div>
  );
}
