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

const menuCategories: MenuCategory[] = [
  {
    title: 'Street Operations',
    items: [
      { label: 'Commit Crimes', href: '/crimes', icon: '🔫' },
      { label: 'Pickpocket', href: '/crimes/pickpocket', icon: '👛' },
      { label: 'Rob Store', href: '/crimes/rob_store', icon: '🏪' },
      { label: 'Steal Car', href: '/crimes/steal_car', icon: '🚗' },
      { label: 'Warehouse Heist', href: '/crimes/bank_heist', icon: '🏦' },
      { label: 'Murder', href: '/murder', icon: '🔫' },
      { label: 'Street Dealer', href: '/street-dealer', icon: '💊' },
      { label: 'Weed Grow', href: '/weed-grow', icon: '🌱' },
      { label: 'Safehouse', href: '/safehouse', icon: '🏠' },
      { label: 'Race', href: '/race', icon: '🏁' },
      { label: 'Admin Tools', href: '/admin', icon: '🛠' },
    ],
  },
  {
    title: 'Family',
    items: [
      { label: 'My Family', href: '/families', icon: '👥' },
      { label: 'Family Bank', href: '/families?tab=banking', icon: '💰' },
      { label: 'Family Profile', href: '/families?tab=profile', icon: '📋' },
      { label: 'Jail', href: '/jail', icon: '🔒' },
    ],
  },
  {
    title: 'Support Services',
    items: [
      { label: 'Hospital', href: '/hospital', icon: '🏥' },
      { label: 'Metal Factory', href: '/metal-factory', icon: '🏭' },
      { label: 'General Bank', href: '/bank', icon: '🏦' },
    ],
  },
  {
    title: 'Journey',
    items: [
      { label: 'Player Guide', href: '/journey/guide', icon: '📖' },
      { label: 'In-Game Tips', href: '/journey/tips', icon: '💡' },
      { label: 'How to Use Menus', href: '/journey/menus', icon: '🧭' },
      { label: 'Roadmap & Future', href: '/journey/roadmap', icon: '🚀' },
    ],
  },
  {
    title: 'Casino',
    items: [
      { label: 'Casino Floor', href: '/casino', icon: '🎰' },
      { label: 'Lottery', href: '/casino/lottery', icon: '🎟️' },
    ],
  },
  {
    title: 'Markets',
    items: [
      { label: 'Stock Exchange', href: '/stocks', icon: '📈' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isItemActive = (item: MenuItem) => {
    const currentUrl = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');

    // Exact match for href (handles query for family)
    if (item.href === currentUrl) return true;

    // For crime dedicated paths
    if (item.href.startsWith('/crimes/') && pathname.startsWith('/crimes/')) {
      return item.href === pathname;
    }

    // Main Commit Crimes only on /crimes (not sub)
    if (item.label === 'Commit Crimes' && pathname === '/crimes') return true;

    // Family
    if (item.label === 'My Family' && pathname === '/families' && !searchParams.get('tab')) return true;
    if (item.label === 'Donation Bank' && pathname === '/families' && searchParams.get('tab') === 'banking') return true;

    // Reputation / Leaderboards
    if (item.label === 'Leaderboard' && pathname === '/leaderboard') return true;
    if (item.label === 'Families Leaderboard' && pathname === '/families/leaderboard') return true;

    // Personal Bank
    if (item.label === 'General Bank' && pathname === '/bank') return true;

    // Shop
    if (item.label === 'Shop' && pathname === '/shop') return true;

    // Hospital
    if (item.label === 'Hospital' && pathname === '/hospital') return true;

    // Armory
    if (item.label === 'Armory' && pathname === '/armory') return true;

    return false;
  };

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto sticky top-14 hidden lg:block">
      <div className="p-4">
        {menuCategories.map((category) => (
          <div key={category.title} className="mb-6">
            <div className="px-3 mb-2 text-xs font-bold uppercase tracking-widest text-red-500/70">
              {category.title}
            </div>
            <div className="space-y-0.5">
              {category.items.map((item) => {
                const active = isItemActive(item);

                const isSoon = item.href === '#';
                return isSoon ? (
                  <span
                    key={item.href + item.label}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-zinc-600 cursor-not-allowed"
                  >
                    <span className="text-base w-5">{item.icon}</span>
                    <span>{item.label}</span>
                    <span className="ml-auto text-[9px] bg-zinc-800 px-1.5 py-px rounded">SOON</span>
                  </span>
                ) : (
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
            Mafia Game 2026 • The Family Table
          </div>
        </div>
      </div>
    </aside>
  );
}
