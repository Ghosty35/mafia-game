'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';
import {
  buildLeftMenu,
  rightMenuCategories,
  isMenuItemActive,
  type MenuCategory,
} from './menuData';
import { useMobileDrawer } from './MobileDrawerContext';

// Collapsible section state persisted across tab switches.
const SECTION_STORAGE_KEY = 'mobile-nav-sections';

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

export default function MobileNav() {
  const { open, setOpen } = useMobileDrawer();
  const [tab, setTab] = useState<'game' | 'social'>('game');
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => loadOpenSections());
  const [animatingSections, setAnimatingSections] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { player } = usePlayer();
  const { t } = useLanguage();

  const qs = searchParams.toString();

  // The drawer renders through a portal into document.body (see below), which
  // is only available after mount - guard so SSR and first hydration match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the drawer on every navigation
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname, qs, setOpen]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const isAdmin = !!player?.staff_role;
  const gameCategories: MenuCategory[] = buildLeftMenu(isAdmin);
  const categories = tab === 'game' ? gameCategories : rightMenuCategories;

  // Persist section open/close state
  useEffect(() => {
    saveOpenSections(openSections);
  }, [openSections]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!prev[key]) {
        setAnimatingSections((s) => new Set(s).add(key));
        setTimeout(() => setAnimatingSections((s) => { const n = new Set(s); n.delete(key); return n; }), 300);
      }
      return next;
    });
  };

  // Filter items by search query (case-insensitive)
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;

    return categories
      .map((cat) => {
        const filteredItems = cat.items.filter((item) => {
          const label = t(item.labelKey).toLowerCase();
          return label.includes(q) || item.href.toLowerCase().includes(q);
        });
        return { ...cat, items: filteredItems };
      })
      .filter((cat) => cat.items.length > 0);
  }, [categories, search, t]);

  // Top-level pages that live in the (md+) top bar; on mobile they are only
  // reachable through this drawer.
  const topItems =
    tab === 'game'
      ? ([
          { labelKey: 'nav_home', href: '/dashboard', icon: '🏠' },
          { labelKey: 'nav_rankings', href: '/dashboard/rankings', icon: '📊' },
          { labelKey: 'nav_about', href: '/about', icon: 'ℹ️' },
        ] as const)
      : ([] as const);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav_menu')}
        className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 active:bg-zinc-800"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {mounted && open && createPortal(
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-sm bg-zinc-950 border-r border-zinc-800 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-16 border-b border-zinc-800/80 shrink-0 bg-zinc-950/80 backdrop-blur-sm">
              <span className="font-black tracking-[-1.5px] text-base">
                <span className="text-red-600">MAFIA</span>
                <span className="text-white/90">GAME</span>
              </span>
              <div className="flex items-center gap-2">
                <LanguageSwitcher />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('common_close')}
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 active:scale-95 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Search bar */}
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

            {/* Game / Social tabs */}
            <div className="flex gap-1.5 p-2 border-b border-zinc-800/80 shrink-0">
              {(
                [
                  { id: 'game', label: t('nav_menu') },
                  { id: 'social', label: t('nav_social') },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                    tab === id
                      ? 'bg-red-950/60 text-red-400 border border-red-900/60 shadow-[0_0_12px_rgba(220,38,38,0.12)]'
                      : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {/* Quick links (only on Game tab, only when not searching) */}
              {topItems.length > 0 && !search && (
                <div className="mb-4 space-y-0.5">
                  {topItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all ${
                        pathname === item.href
                          ? 'bg-amber-950/40 text-amber-400 border border-amber-900/50 font-medium shadow-[0_0_12px_rgba(245,158,11,0.08)]'
                          : 'text-zinc-300 hover:bg-zinc-900 hover:text-white active:bg-zinc-800'
                      }`}
                    >
                      <span className="text-base w-6 text-center flex-shrink-0">{item.icon}</span>
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  ))}
                </div>
              )}

              {/* Menu categories with collapsible sections */}
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
                        aria-controls={`section-${sectionKey}`}
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
                        id={`section-${sectionKey}`}
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
                <div className="text-[10px] text-zinc-600 font-medium tracking-wide">{t('side_footer_left')}</div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
