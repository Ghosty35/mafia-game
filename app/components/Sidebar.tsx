'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { buildLeftMenu, isMenuItemActive } from './menuData';

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { player } = usePlayer();
  const { t } = useLanguage();

  const isAdmin = player?.username === 'YGhosty';
  const categories = buildLeftMenu(isAdmin);
  const search = searchParams.toString();

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden lg:block">
      <div className="p-4">
        {categories.map((category) => (
          <div key={category.titleKey} className="mb-6">
            <div className="px-3 mb-2 text-xs font-bold uppercase tracking-widest text-red-500/70">
              {t(category.titleKey)}
            </div>
            <div className="space-y-0.5">
              {category.items.map((item) => {
                const active = isMenuItemActive(item, pathname, search);
                return (
                  <Link
                    key={item.href + item.labelKey}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      active
                        ? 'bg-red-950 text-red-400 border border-red-900/50 font-medium'
                        : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                    }`}
                  >
                    <span className="text-base w-5">{item.icon}</span>
                    <span>{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 pt-4 border-t border-zinc-800 px-3">
          <div className="text-[10px] text-zinc-600">{t('side_footer_left')}</div>
        </div>
      </div>
    </aside>
  );
}
