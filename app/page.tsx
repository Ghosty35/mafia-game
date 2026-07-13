'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function Home() {
  const { t } = useLanguage();

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-zinc-950 relative overflow-hidden">
      {/* Matching dramatic background */}
      <div className="absolute inset-0 bg-[radial-gradient(#27272a_0.8px,transparent_1px)] bg-[length:4px_4px] opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-black/80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(185,28,28,0.08)_0%,transparent_50%)]" />

      <div className="relative z-10 max-w-3xl text-center px-4">
        <div className="mb-6">
          <div className="inline text-7xl sm:text-8xl font-black tracking-[-4px]">
            <span className="text-red-600">MAFIA</span> <span className="text-white">GAME</span>
          </div>
          <div className="text-red-500/70 text-xs tracking-[6px] mt-1">2026</div>
        </div>

        <p className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3 text-white">
          {t('landing_tagline')}
        </p>
        <p className="text-lg text-zinc-400 max-w-lg mx-auto mb-10">
          {t('landing_description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/login"
            className="bg-red-700 hover:bg-red-600 active:bg-red-800 px-10 py-4 rounded-2xl text-lg font-bold transition-all shadow-xl shadow-red-950/60"
          >
            {t('landing_sign_in')}
          </Link>
          <Link
            href="/register"
            className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 px-10 py-4 rounded-2xl text-lg font-bold transition-all"
          >
            {t('landing_create_account')}
          </Link>
        </div>

        <div className="mt-12 text-[10px] text-zinc-600 tracking-[3px]">
          NO RULES • NO MERCY • NO WITNESSES
        </div>
      </div>
    </main>
  );
}
