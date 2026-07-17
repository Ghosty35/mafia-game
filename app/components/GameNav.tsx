'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import LanguageSwitcher from './LanguageSwitcher';
import MobileNav from './MobileNav';

// High-level navigation. Every item links to a distinct destination.
const baseItems: { labelKey: TranslationKey; href: string; icon: string }[] = [
  { labelKey: 'nav_home', href: '/dashboard', icon: '🏠' },
  { labelKey: 'nav_rankings', href: '/dashboard/rankings', icon: '📊' },
  { labelKey: 'nav_about', href: '/about', icon: 'ℹ️' },
];

export default function GameNav() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [onlineCount, setOnlineCount] = useState<number>(42);

  // Fetch dynamic online count (from server stats RPC)
  useEffect(() => {
    const fetchOnline = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.rpc('get_server_stats');
        if (data && typeof data.online_people === 'number') {
          setOnlineCount(data.online_people);
        }
      } catch {
        // keep fallback
      }
    };
    fetchOnline();
    const id = setInterval(fetchOnline, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, []);

  const navItems = [
    ...baseItems.map((item) => ({ ...item, label: t(item.labelKey) })),
    { label: t('nav_online', { count: onlineCount }), href: '/server-status', icon: '👥' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-lg border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          {/* Mobile drawer trigger (hidden on lg+ where the sidebars live) */}
          <Suspense fallback={<div className="w-10 h-10 lg:hidden" />}>
            <MobileNav />
          </Suspense>

          <Link
            href="/dashboard"
            className="font-black text-lg tracking-[-1px] whitespace-nowrap flex items-center gap-1.5 group"
          >
            <span className="text-amber-500 group-hover:text-amber-400 transition-colors">HUSTLER&apos;S</span>
            <span className="text-zinc-300 group-hover:text-white transition-colors">WAY</span>
          </Link>

          <div className="hidden md:flex items-center gap-1 overflow-x-auto pl-2 border-l border-zinc-800">
            {navItems.map(({ label, href, icon }) => {
              const isActive = href && pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-amber-950/50 text-amber-400 border border-amber-800/50 shadow-[0_0_10px_rgba(245,158,11,0.1)]'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-white border border-transparent'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:block">
            <LanguageSwitcher />
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-4 py-1.5 rounded-xl text-sm font-semibold transition-all"
            >
              {t('dash_sign_out')}
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
