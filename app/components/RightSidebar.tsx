'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { rightMenuCategories, isMenuItemActive } from './menuData';

export default function RightSidebar() {
  return (
    <aside className="w-64 bg-zinc-950 border-l border-zinc-800/80 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden lg:block" aria-label="Right sidebar navigation">
      <div className="p-4">
        <div>RIGHTSIDEBAR TEST</div>
      </div>
    </aside>
  );
}
