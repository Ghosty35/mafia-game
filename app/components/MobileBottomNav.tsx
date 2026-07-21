'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { player } = usePlayer();
  const { t } = useLanguage();

  // Live unread DM count for the messages tab (RLS: own inbox only).
  // Same lightweight count query PlayerInfoCard uses, polled every 30s.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!player?.id) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const fetchUnread = async () => {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('to_player_id', player.id)
        .eq('read', false);
      if (!cancelled) setUnread(count ?? 0);
    };
    fetchUnread();
    const iv = setInterval(fetchUnread, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [player?.id]);

  const items = [
    { href: '/dashboard', icon: '🏠', label: t('nav_home') },
    { href: '/crimes', icon: '🔫', label: t('nav_crimes') },
    { href: '/messages', icon: '✉️', label: t('pi_messages'), badge: unread },
    { href: '/bank', icon: '🏦', label: t('menu_bank') },
    { href: '#', icon: '⋯', label: t('nav_more'), action: 'more' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/80 pb-safe" aria-label="Mobile navigation">
      <div className="flex items-center justify-around h-16">
        {items.map(({ href, icon, label, badge, action }) => {
          if (action === 'more') {
            return (
              <button
                key={href}
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('open-mobile-nav'));
                }}
                aria-label={label}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all relative text-zinc-500 hover:text-zinc-300 active:text-amber-400 active:scale-95"
              >
                <span className="text-xl relative">{icon}</span>
                <span className="text-[10px] font-medium truncate w-full text-center">{label}</span>
              </button>
            );
          }

          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all relative ${
                active ? 'text-amber-400 mobile-nav-active' : 'text-zinc-500 hover:text-zinc-300 active:text-amber-400 active:scale-95'
              }`}
            >
              <span className="text-xl relative">
                {icon}
                {badge ? (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                    {badge > 99 ? '99+' : badge}
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
