'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function Home() {
  const { t } = useLanguage();

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="max-w-2xl text-center">
        <h1 className="text-6xl sm:text-7xl font-black tracking-tight mb-4">
          <span className="text-red-600">MAFIA</span> GAME
        </h1>
        <p className="text-xl text-zinc-300 font-semibold mb-4">
          {t('landing_tagline')}
        </p>
        <p className="text-zinc-500 mb-10 max-w-md mx-auto">
          {t('landing_description')}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/login"
            className="bg-red-700 hover:bg-red-600 px-8 py-4 rounded-lg text-lg font-bold transition-colors"
          >
            {t('landing_sign_in')}
          </Link>
          <Link
            href="/register"
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-8 py-4 rounded-lg text-lg font-bold transition-colors"
          >
            {t('landing_create_account')}
          </Link>
        </div>
      </div>
    </main>
  );
}
