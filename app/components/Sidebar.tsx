'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { buildLeftMenu, isMenuItemActive } from './menuData';

export default function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800/80 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden lg:block" aria-label="Sidebar navigation">
      <div className="p-4">
        <div>SIDEBAR TEST</div>
      </div>
    </aside>
  );
}
