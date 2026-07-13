'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function TopBar() {
  const { t } = useLanguage();

  return (
    <div className="sticky top-0 z-50 bg-zinc-950 border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-2xl">🔴</span>
            <span className="font-black text-xl tracking-[-1px]">
              <span className="text-red-600">MAFIA</span>
              <span className="text-white">GAME</span>
            </span>
          </Link>
          <div className="hidden md:block text-xs text-zinc-500 border-l border-zinc-800 pl-3 ml-1">
            2026 Edition
          </div>
        </div>

        <div className="flex items-center gap-3">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="px-4 py-1.5 text-sm rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition"
            >
              {t('dash_sign_out')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
