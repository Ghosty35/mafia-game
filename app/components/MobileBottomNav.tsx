'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { player } = usePlayer();
  const { t } = useLanguage();

  const unread = 0; // Could be fetched from context if needed

  const items = [
    { href: '/dashboard', icon: '🏠', label: t('nav_home') },
    { href: '/crimes', icon: '🔫', label: t('nav_crimes') },
    { href: '/messages', icon: '✉️', label: t('pi_messages'), badge: unread },
    { href: '/bank', icon: '🏦', label: t('menu_bank') },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800 pb-safe">
      <div className="flex items-center justify-around h-16">
        {items.map(({ href, icon, label, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all relative ${
                active ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="text-xl relative">
                {icon}
                {badge ? (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-medium truncate w-full text-center">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
