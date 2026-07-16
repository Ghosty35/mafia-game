// Single source of truth for all game navigation menus.
// Labels are translation keys (en.json / nl.json) — never hardcoded text —
// so the left sidebar, right sidebar and mobile drawer always stay in sync.

import type { TranslationKey } from '@/lib/i18n/translations';

export interface MenuItem {
  labelKey: TranslationKey;
  href: string;
  icon: string;
}

export interface MenuCategory {
  titleKey: TranslationKey;
  items: MenuItem[];
}

// Left sidebar: everything you DO in the city.
// Social structures (Family, leaderboards, messages) live in the right sidebar.
export const leftMenuCategories: MenuCategory[] = [
  {
    titleKey: 'side_street_ops',
    items: [
      { labelKey: 'menu_commit_crimes', href: '/crimes', icon: '🔫' },
      { labelKey: 'menu_pickpocket', href: '/crimes/pickpocket', icon: '👛' },
      { labelKey: 'menu_rob_store', href: '/crimes/rob_store', icon: '🏪' },
      { labelKey: 'menu_steal_car', href: '/crimes/steal_car', icon: '🚗' },
      { labelKey: 'menu_warehouse_heist', href: '/crimes/warehouse_heist', icon: '🏦' },
      { labelKey: 'menu_heists', href: '/heists', icon: '💣' },
      { labelKey: 'menu_murder', href: '/murder', icon: '🔫' },
      { labelKey: 'menu_street_dealer', href: '/street-dealer', icon: '💊' },
      { labelKey: 'menu_weed_grow', href: '/weed-grow', icon: '🌱' },
      { labelKey: 'menu_detective', href: '/detective', icon: '🕵️' },
    ],
  },
  {
    titleKey: 'side_economy',
    items: [
      { labelKey: 'menu_bank', href: '/bank', icon: '🏦' },
      { labelKey: 'menu_stocks', href: '/stocks', icon: '📈' },
      { labelKey: 'menu_real_estate', href: '/real-estate', icon: '🏠' },
      { labelKey: 'menu_marketplace', href: '/marketplace', icon: '🏛️' },
      { labelKey: 'menu_shop', href: '/shop', icon: '🛒' },
      { labelKey: 'menu_armory', href: '/armory', icon: '🗡️' },
      { labelKey: 'menu_metal_factory', href: '/metal-factory', icon: '🏭' },
    ],
  },
  {
    titleKey: 'side_garage_travel',
    items: [
      { labelKey: 'menu_garage', href: '/garage', icon: '🚙' },
      { labelKey: 'menu_race', href: '/race', icon: '🏁' },
      { labelKey: 'menu_travel', href: '/travel', icon: '✈️' },
    ],
  },
  {
    titleKey: 'side_city_services',
    items: [
      { labelKey: 'menu_safehouse', href: '/safehouse', icon: '🏠' },
      { labelKey: 'menu_hospital', href: '/hospital', icon: '🏥' },
      { labelKey: 'menu_jail', href: '/jail', icon: '🔒' },
    ],
  },
  {
    titleKey: 'side_casino',
    items: [
      { labelKey: 'menu_casino_floor', href: '/casino', icon: '🎰' },
      { labelKey: 'menu_lottery', href: '/casino/lottery', icon: '🎟️' },
    ],
  },
  {
    titleKey: 'side_journey',
    items: [
      { labelKey: 'menu_guide', href: '/journey/guide', icon: '📖' },
      { labelKey: 'menu_tips', href: '/journey/tips', icon: '💡' },
      { labelKey: 'menu_menus', href: '/journey/menus', icon: '🧭' },
      { labelKey: 'menu_roadmap', href: '/journey/roadmap', icon: '🚀' },
    ],
  },
];

export const adminCategory: MenuCategory = {
  titleKey: 'side_admin',
  items: [{ labelKey: 'menu_admin_tools', href: '/admin', icon: '🛠' }],
};

// Right sidebar: the social side of the game.
// All Family business lives here (single Family hub, Bulletstar style).
export const rightMenuCategories: MenuCategory[] = [
  {
    titleKey: 'side_family',
    items: [
      { labelKey: 'menu_my_family', href: '/families', icon: '👥' },
      { labelKey: 'menu_family_bank', href: '/families?tab=banking', icon: '💰' },
      { labelKey: 'menu_family_donations', href: '/families?tab=donations', icon: '🏦' },
      { labelKey: 'menu_family_profile', href: '/families?tab=profile', icon: '📋' },
      { labelKey: 'menu_families_leaderboard', href: '/families/leaderboard', icon: '👑' },
    ],
  },
  {
    titleKey: 'side_reputation',
    items: [
      { labelKey: 'menu_leaderboard', href: '/leaderboard', icon: '🏆' },
      { labelKey: 'menu_most_wanted', href: '/most-wanted', icon: '🚨' },
      { labelKey: 'menu_my_profile', href: '/profile', icon: '👤' },
      { labelKey: 'menu_server_status', href: '/server-status', icon: '🟢' },
    ],
  },
  {
    titleKey: 'side_communication',
    items: [{ labelKey: 'menu_messages', href: '/messages', icon: '✉️' }],
  },
];

/** Shared active-state check so all three menus highlight identically. */
export function isMenuItemActive(
  item: MenuItem,
  pathname: string,
  search: string,
): boolean {
  const currentUrl = pathname + (search ? `?${search}` : '');

  // Exact match (handles ?tab= query params)
  if (item.href === currentUrl) return true;

  // Dedicated crime pages: only exact path wins
  if (item.href.startsWith('/crimes/') && pathname.startsWith('/crimes/')) {
    return item.href === pathname;
  }

  // Plain path match for items without query params — but a ?tab= page
  // should not also highlight the base item.
  if (!item.href.includes('?') && pathname === item.href && !search.includes('tab=')) {
    return true;
  }

  return false;
}
