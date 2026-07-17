'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { rightMenuCategories, isMenuItemActive } from './menuData';

export default function RightSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const search = searchParams.toString();

  return (
    <aside className="w-64 bg-zinc-950 border-l border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden xl:block">
      <div className="p-4">
        {rightMenuCategories.map((category) => (
          <div key={category.titleKey} className="mb-6">
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[3px] text-amber-500/60">
              {t(category.titleKey)}
            </div>
            <div className="space-y-0.5">
              {category.items.map((item) => {
                const active = isMenuItemActive(item, pathname, search);
                return (
                  <Link
                    key={item.href + item.labelKey}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                      active
                        ? 'bg-amber-950/40 text-amber-400 border border-amber-900/40 font-medium shadow-[0_0_8px_rgba(245,158,11,0.06)]'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-base w-5 text-center">{item.icon}</span>
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 pt-4 border-t border-zinc-800 px-3">
          <div className="text-[10px] text-zinc-600">{t('side_footer_right')}</div>
        </div>
      </div>
    </aside>
  );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 pt-4 border-t border-zinc-800 px-3">
          <div className="text-[10px] text-zinc-600">{t('side_footer_right')}</div>
        </div>
      </div>
    </aside>
  );
}
