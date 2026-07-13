import type { TranslationKey } from './i18n/translations';

// The rank ladder. Levels stay numeric in the database;
// ranks are the mafia-flavored display layer on top.
// Order matters: lowest rank first.
export const ranks: { minLevel: number; key: TranslationKey }[] = [
  { minLevel: 1, key: 'rank_slum_rat' },
  { minLevel: 2, key: 'rank_street_punk' },
  { minLevel: 4, key: 'rank_thug' },
  { minLevel: 6, key: 'rank_thief' },
  { minLevel: 8, key: 'rank_hustler' },
  { minLevel: 10, key: 'rank_gangster' },
  { minLevel: 13, key: 'rank_enforcer' },
  { minLevel: 16, key: 'rank_hitman' },
  { minLevel: 20, key: 'rank_soldato' },
  { minLevel: 24, key: 'rank_capo' },
  { minLevel: 28, key: 'rank_consigliere' },
  { minLevel: 32, key: 'rank_underboss' },
  { minLevel: 36, key: 'rank_boss' },
  { minLevel: 41, key: 'rank_don' },
  { minLevel: 46, key: 'rank_godfather' },
];

// Reaching this level unlocks Rebirth (must match rebirth() in the database)
export const GODFATHER_LEVEL = 46;

export function getRank(level: number) {
  let current = ranks[0];
  for (const rank of ranks) {
    if (level >= rank.minLevel) current = rank;
  }
  return current;
}

// The next rank to reach, or null if already Godfather
export function getNextRank(level: number) {
  return ranks.find((rank) => rank.minLevel > level) ?? null;
}
