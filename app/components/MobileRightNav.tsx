'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { rightMenuCategories, isMenuItemActive } from './menuData';
import { useMobileDrawer } from './MobileDrawerContext';

// Mirrors the desktop RightSidebar (Journey/Profile/Murder/Family/Reputation)
// as its own slide-in-from-right drawer, so mobile has the same two-sidebar
// navigation shape as desktop instead of burying it in a second tab inside
// the left hamburger menu.
const SECTION_STORAGE_KEY = 'mobile-right-nav-sections';

function loadOpenSections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOpenSections(state: Record<string, boolean>) {
  try {
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export default function MobileRightNav() {
  const { rightOpen, setRightOpen } = useMobileDrawer();
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => loadOpenSections());
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const qs = searchParams.toString();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRightOpen(false);
  }, [pathname, qs, setRightOpen]);

  useEffect(() => {
    document.body.style.overflow = rightOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [rightOpen]);

  useEffect(() => {
    saveOpenSections(openSections);
  }, [openSections]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rightMenuCategories;
    return rightMenuCategories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => {
          const label = t(item.labelKey).toLowerCase();
          return label.includes(q) || item.href.toLowerCase().includes(q);
        }),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [search, t]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setRightOpen(true)}
        aria-label={t('nav_profile_menu', { default: 'Profile & family menu' })}
        className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 active:bg-zinc-800"
      >
        <span className="text-lg">👤</span>
      </button>

      {rightOpen && (
        <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setRightOpen(false)}
          />

          <div className="absolute inset-y-0 right-0 w-[85vw] max-w-sm bg-zinc-950 border-l border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between px-4 h-16 border-b border-zinc-800/80 shrink-0 bg-zinc-950/80 backdrop-blur-sm">
              <span className="font-black tracking-[-1px] text-base text-zinc-200">
                {t('nav_profile_menu', { default: 'Profile & family menu' })}
              </span>
              <button
                type="button"
                onClick={() => setRightOpen(false)}
                aria-label={t('common_close')}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            <div className="px-3 py-2.5 border-b border-zinc-800/80 shrink-0">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('nav_search_placeholder', { default: 'Search pages...' })}
                  aria-label={t('nav_search_placeholder', { default: 'Search pages...' })}
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl pl-10 pr-10 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-amber-600/60 focus:ring-1 focus:ring-amber-600/20 transition-all"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 active:text-white text-xs w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-800 transition-all"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-1">
                {filteredCategories.map((category) => {
                  const sectionKey = category.titleKey;
                  const isOpen = openSections[sectionKey] ?? true;

                  return (
                    <div key={sectionKey} className="mb-1">
                      <button
                        type="button"
                        onClick={() => toggleSection(sectionKey)}
                        aria-expanded={isOpen}
                        aria-controls={`right-section-${sectionKey}`}
                        className="flex items-center justify-between w-full px-3 py-3 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors rounded-lg hover:bg-zinc-900/50 group"
                      >
                        <span className="group-hover:text-amber-400 transition-colors">{t(category.titleKey)}</span>
                        <svg
                          className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-300 ease-out ${isOpen ? 'rotate-90 text-amber-500/70' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      <div
                        id={`right-section-${sectionKey}`}
                        className={`overflow-hidden transition-all duration-300 ease-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
                        aria-hidden={!isOpen}
                      >
                        <div className="space-y-0.5 pl-1 pb-1">
                          {category.items.map((item) => {
                            const active = isMenuItemActive(item, pathname, qs);
                            return (
                              <Link
                                key={item.href + item.labelKey}
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all ${
                                  active
                                    ? 'bg-amber-950/40 text-amber-400 border border-amber-900/40 font-medium shadow-[0_0_12px_rgba(245,158,11,0.08)]'
                                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white active:bg-zinc-800'
                                }`}
                              >
                                <span className="text-base w-6 text-center flex-shrink-0">{item.icon}</span>
                                <span className="truncate flex-1">{t(item.labelKey)}</span>
                                {active && (
                                  <span className="text-[10px] text-amber-500/70 font-semibold uppercase tracking-wider">•</span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-800/60 px-3">
                <div className="text-[10px] text-zinc-600 font-medium tracking-wide">{t('side_footer_right')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
