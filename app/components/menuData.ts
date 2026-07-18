// Single source of truth for all game navigation menus.
// Labels are translation keys (en.json / nl.json) — never hardcoded text —
// so the left sidebar, right sidebar and mobile drawer always stay in sync.
//
// Structure follows the bug-inspectie menu spec:
//   LEFT  = what you DO:   Street Operations, Economy, City Services, Casino, Administration
//   RIGHT = who you ARE:   Journey, Profile, Murder, My Family, Reputation
// Items for systems that don't exist yet (Post Office, Tune Shop, Junkyard,
// casino standalones, Support/Report/Tickets, Join/Leave Family standalones,
// Tax Bank leaderboard) are added when those pages are built.

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

export const leftMenuCategories: MenuCategory[] = [
  {
    titleKey: 'side_journey',
    items: [
      { labelKey: 'menu_hustlers_way', href: '/hustlers-way', icon: '🛤️' },
      { labelKey: 'menu_roadmap', href: '/journey/roadmap', icon: '🚀' },
      { labelKey: 'menu_menus', href: '/journey/menus', icon: '🧭' },
      { labelKey: 'menu_tips', href: '/journey/tips', icon: '💡' },
      { labelKey: 'menu_guide', href: '/journey/guide', icon: '📖' },
      { labelKey: 'menu_rebirth', href: '/rebirth', icon: '👑' },
      { labelKey: 'menu_server_status', href: '/server-status', icon: '🟢' },
      { labelKey: 'menu_about', href: '/about', icon: 'ℹ️' },
    ],
  },
  {
    titleKey: 'side_street_ops',
    items: [
      { labelKey: 'menu_commit_crimes', href: '/crimes', icon: '🔫' },
      { labelKey: 'menu_pickpocket', href: '/crimes/pickpocket', icon: '👛' },
      { labelKey: 'menu_rob_store', href: '/crimes/rob_store', icon: '🏪' },
      { labelKey: 'menu_steal_car', href: '/crimes/steal_car', icon: '🚗' },
      { labelKey: 'menu_street_dealer', href: '/street-dealer', icon: '💊' },
      { labelKey: 'menu_warehouse_heist', href: '/crimes/warehouse_heist', icon: '🏦' },
      { labelKey: 'menu_heists', href: '/heists', icon: '💣' },
      { labelKey: 'menu_weed_grow', href: '/weed-grow', icon: '🌱' },
      { labelKey: 'menu_race', href: '/race', icon: '🏁' },
    ],
  },
  {
    titleKey: 'side_economy',
    items: [
      { labelKey: 'menu_bank', href: '/bank', icon: '🏦' },
      { labelKey: 'menu_laundering', href: '/laundering', icon: '🧼' },
      { labelKey: 'menu_real_estate', href: '/real-estate', icon: '🏠' },
      { labelKey: 'menu_red_light', href: '/red-light', icon: '🌃' },
      { labelKey: 'menu_druglab', href: '/drug-lab', icon: '🧪' },
      { labelKey: 'menu_drug_marketplace', href: '/drug-marketplace', icon: '💊' },
      { labelKey: 'menu_post_office', href: '/post-office', icon: '📮' },
      { labelKey: 'menu_stocks', href: '/stocks', icon: '📈' },
      { labelKey: 'menu_marketplace', href: '/marketplace', icon: '🏛️' },
      { labelKey: 'menu_shop', href: '/shop', icon: '🛒' },
      { labelKey: 'menu_vip_store', href: '/shop/vip', icon: '👑' },
      { labelKey: 'menu_tax_bank', href: '/reputations/tax-bank', icon: '🏛️' },
    ],
  },
  {
    titleKey: 'side_casino',
    items: [
      { labelKey: 'menu_casino_floor', href: '/casino', icon: '🎰' },
      { labelKey: 'menu_blackjack', href: '/casino/blackjack', icon: '🃏' },
      { labelKey: 'menu_roulette', href: '/casino/roulette', icon: '🎡' },
      { labelKey: 'menu_poker', href: '/casino/poker', icon: '🎴' },
      { labelKey: 'menu_rps', href: '/casino/rps', icon: '✊' },
      { labelKey: 'menu_lottery', href: '/casino/lottery', icon: '🎟️' },
    ],
  },
];

// Administration (bug-inspectie): Support / Report / Tickets are for every
// player; only Admin Tools is admin-only, and it sits in the same category.
const administrationItems: MenuItem[] = [
  { labelKey: 'menu_support', href: '/support', icon: '🛟' },
  { labelKey: 'menu_report', href: '/report', icon: '🚩' },
  { labelKey: 'menu_tickets', href: '/tickets', icon: '🎫' },
];

const adminToolsItem: MenuItem = { labelKey: 'menu_admin_tools', href: '/admin', icon: '🛠' };

/** Left sidebar for this player. Admins get the extra tools entry. */
export function buildLeftMenu(isAdmin: boolean): MenuCategory[] {
  return [
    ...leftMenuCategories,
    {
      titleKey: 'side_admin',
      items: isAdmin ? [...administrationItems, adminToolsItem] : administrationItems,
    },
  ];
}

export const rightMenuCategories: MenuCategory[] = [
  {
    titleKey: 'side_communication',
    items: [
      { labelKey: 'menu_messages', href: '/messages', icon: '✉️' },
      { labelKey: 'menu_forums', href: '/forum', icon: '📢' },
      { labelKey: 'menu_travel', href: '/travel', icon: '🧭' },
      { labelKey: 'menu_hospital', href: '/hospital', icon: '🏥' },
      { labelKey: 'menu_jail', href: '/jail', icon: '🔒' },
      { labelKey: 'menu_garage', href: '/garage', icon: '🚙' },
      { labelKey: 'menu_tune_shop', href: '/garage/tune-shop', icon: '🔧' },
      { labelKey: 'menu_junkyard', href: '/garage/junkyard', icon: '🗜️' },
      { labelKey: 'menu_gym', href: '/gym', icon: '🏋️' },
      { labelKey: 'menu_wait_times', href: '/wachttijden', icon: '⏱️' },
    ],
  },
  {
    titleKey: 'side_profile',
    items: [
      { labelKey: 'menu_my_profile', href: '/profile', icon: '👤' },
      { labelKey: 'menu_safehouse', href: '/safehouse', icon: '🏠' },
    ],
  },
  {
    titleKey: 'side_murder_cat',
    items: [
      { labelKey: 'menu_detective', href: '/detective', icon: '🕵️' },
      { labelKey: 'menu_murder', href: '/murder', icon: '🔫' },
      { labelKey: 'menu_metal_factory', href: '/metal-factory', icon: '🏭' },
      { labelKey: 'menu_armory', href: '/armory', icon: '🗡️' },
    ],
  },
  {
    titleKey: 'side_family',
    items: [
      { labelKey: 'menu_my_family', href: '/families', icon: '👥' },
      { labelKey: 'menu_family_join', href: '/families/join', icon: '🤝' },
      { labelKey: 'menu_family_inbox', href: '/families/inbox', icon: '📥' },
      { labelKey: 'menu_family_bank', href: '/families/bank', icon: '💰' },
      { labelKey: 'menu_family_donations', href: '/families/donations', icon: '🎁' },
      { labelKey: 'menu_family_profile', href: '/families/profile', icon: '📋' },
      { labelKey: 'menu_territories', href: '/territories', icon: '🗺️' },
      { labelKey: 'menu_crusher', href: '/families/crusher', icon: '🗜️' },
      { labelKey: 'menu_bounties', href: '/families/bounties', icon: '🎯' },
      { labelKey: 'menu_players_without_family', href: '/families/without-family', icon: '👤' },
      { labelKey: 'menu_leave_family', href: '/families/leave', icon: '🚪' },
    ],
  },
  {
    titleKey: 'side_reputation',
    items: [
      { labelKey: 'menu_leaderboard', href: '/leaderboard', icon: '🏆' },
      { labelKey: 'menu_crime_leaderboard', href: '/crime-leaderboard', icon: '🔫' },
      { labelKey: 'menu_most_wanted', href: '/most-wanted', icon: '🚨' },
      { labelKey: 'menu_families_leaderboard', href: '/families/leaderboard', icon: '👑' },
      { labelKey: 'menu_tax_bank', href: '/reputations/tax-bank', icon: '🏛️' },
    ],
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
