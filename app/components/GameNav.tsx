'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

// High-level navigation. Some features are fully live, others can be marked with Soon if we want to tease.
const baseItems: { label: string; href: string; icon: string }[] = [
  { label: 'Home', href: '/dashboard', icon: '🏠' },
  { label: 'Updates', href: '/dashboard', icon: '📰' },
  { label: 'Logs', href: '/dashboard', icon: '📜' },
  { label: 'About', href: '/about', icon: 'ℹ️' },
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
    ...baseItems,
    { label: `Online ${onlineCount}`, href: '/server-status', icon: '👥' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-lg border-b border-zinc-800">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link
            href="/dashboard"
            className="font-black text-lg tracking-[-1px] whitespace-nowrap flex items-center gap-1"
          >
            <span className="text-red-600">MAFIA</span>
            <span className="text-white/90">GAME</span>
          </Link>

          <div className="flex items-center gap-1 overflow-x-auto pl-2 border-l border-zinc-800">
            {navItems.map(({ label, href, icon }) => {
              const isActive = href && (pathname === href || (href === '/dashboard' && pathname.startsWith('/dashboard')));
              return (
                <Link
                  key={label}
                  href={href}
                  className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-red-950 text-red-400 border border-red-900/60'
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

        <form action="/auth/signout" method="post" className="shrink-0">
          <button
            type="submit"
            className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-4 py-1.5 rounded-xl text-sm font-semibold transition-all"
          >
            {t('dash_sign_out')}
          </button>
        </form>
      </div>
    </nav>
  );
}
