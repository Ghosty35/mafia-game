'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface MenuItem {
  label: string;
  href: string;
  icon: string;
}

interface MenuCategory {
  title: string;
  items: MenuItem[];
}

const rightMenuCategories: MenuCategory[] = [
  {
    title: 'Family (Main Hub - Bulletstar Style)',
    items: [
      { label: 'My Family', href: '/families', icon: '👥' },
      { label: 'Family Bank', href: '/families?tab=banking', icon: '💰' },
      { label: 'Family Donation Bank', href: '/families?tab=donations', icon: '🏦' },
      { label: 'Family Members', href: '/families', icon: '👥' },
      { label: 'Family Online (Live)', href: '/families', icon: '🟢' },
      { label: 'Family Profile', href: '/families?tab=profile', icon: '📋' },
    ],
  },
  {
    title: 'Reputation',
    items: [
      { label: 'Leaderboard', href: '/leaderboard', icon: '🏆' },
      { label: 'Families Leaderboard', href: '/families/leaderboard', icon: '👑' },
    ],
  },
  {
    title: 'Murder & PvP',
    items: [
      { label: 'Murder (Hitman+50%)', href: '/murder', icon: '🔫' },
      { label: 'Race', href: '/race', icon: '🏁' },
      { label: 'Detective Agency', href: '/detective', icon: '🕵️' },
    ],
  },
  {
    title: 'Information & Economy',
    items: [
      { label: 'Real Estate', href: '/real-estate', icon: '🏠' },
      { label: 'Marketplace', href: '/marketplace', icon: '🏛️' },
      { label: 'Street Dealer', href: '/street-dealer', icon: '💊' },
    ],
  },
];

export default function RightSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isItemActive = (item: MenuItem) => {
    const currentUrl = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');
    if (item.href === currentUrl) return true;
    if (item.href.includes('?tab=') && pathname === '/families' && searchParams.get('tab') === 'banking') return true;
    return false;
  };

  return (
    <aside className="w-64 bg-zinc-950 border-l border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden xl:block">
      <div className="p-4">
        {rightMenuCategories.map((category) => (
          <div key={category.title} className="mb-6">
            <div className="px-3 mb-2 text-xs font-bold uppercase tracking-widest text-red-500/70">
              {category.title}
            </div>
            <div className="space-y-0.5">
              {category.items.map((item) => {
                const active = isItemActive(item);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      active
                        ? 'bg-red-950 text-red-400 border border-red-900/50 font-medium'
                        : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                    }`}
                  >
                    <span className="text-base w-5">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 pt-4 border-t border-zinc-800 px-3">
          <div className="text-[10px] text-zinc-600">
            Right Sidebar • Family / Info / Murder
          </div>
        </div>
      </div>
    </aside>
  );
}
