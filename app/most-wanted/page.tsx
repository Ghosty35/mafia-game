'use client';

import Link from 'next/link';
import MostWantedBoard from '../components/MostWantedBoard';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MostWantedPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">🚨 {t('menu_most_wanted')}</h1>
        <p className="text-xs text-zinc-400">{t('mw_page_desc')}</p>
      </div>

      <MostWantedBoard limit={50} />

      <div className="mt-6 text-center">
        <Link href="/leaderboard" className="text-xs text-red-400 hover:underline">
          {t('mw_view_power')}
        </Link>
      </div>
    </div>
  );
}
