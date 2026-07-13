'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

// Pages that exist get a link; future pages show a "Soon" chip.
const items: { key: TranslationKey; href: string | null; icon: string }[] = [
  { key: 'nav_dashboard', href: '/dashboard', icon: '🏠' },
  { key: 'nav_shop', href: null, icon: '🛒' },
  { key: 'nav_family', href: '/families', icon: '👥' },
  { key: 'nav_rankings', href: '/dashboard/rankings', icon: '🏆' },
];

export default function GameNav() {
  const { t } = useLanguage();

  return (
    <nav className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <Link
            href="/dashboard"
            className="font-black tracking-tight whitespace-nowrap"
          >
            <span className="text-red-600">MAFIA</span> GAME
          </Link>

          <div className="flex items-center gap-1 overflow-x-auto">
            {items.map(({ key, href, icon }) =>
              href ? (
                <Link
                  key={key}
                  href={href}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                >
                  {icon} {t(key)}
                </Link>
              ) : (
                <span
                  key={key}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-zinc-600 cursor-not-allowed whitespace-nowrap"
                  title={t('nav_soon')}
                >
                  {icon} {t(key)}
                  <span className="ml-1.5 text-[10px] uppercase bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full align-middle">
                    {t('nav_soon')}
                  </span>
                </span>
              )
            )}
          </div>
        </div>

        <form action="/auth/signout" method="post" className="shrink-0 mr-24">
          <button
            type="submit"
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors"
          >
            {t('dash_sign_out')}
          </button>
        </form>
      </div>
    </nav>
  );
}
