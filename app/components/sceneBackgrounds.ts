// Per-section background art. Each area of the game gets its own scene so
// the world changes as you move around it, instead of one flat image
// everywhere. Keyed by route prefix, longest match wins.
//
// All art is original, generated for this project - no stock or
// third-party game assets.

export type Scene = {
  /** Public path of the background image. */
  src: string;
  /** Black scrim opacity over the art. Denser for stat-heavy pages so the
   *  UI stays legible; lighter for pages that are mostly prose/cards. */
  scrim: number;
  /** Optional character standing in the scene, anchored bottom-right.
   *  Purely decorative - hidden on small screens where it would crowd
   *  the content. */
  character?: { src: string; opacity: number };
};

const CITY: Scene = { src: '/bg-city-street.webp', scrim: 0.72 };
const CRIME: Scene = { src: '/bg-alley.webp', scrim: 0.74 };
const CASINO: Scene = {
  src: '/bg-casino.webp',
  scrim: 0.76,
  character: { src: '/char-cards.webp', opacity: 0.5 },
};
const BANK: Scene = { src: '/bg-bank.webp', scrim: 0.74 };

/** Route prefix -> scene. Order does not matter; the longest prefix wins. */
const ROUTE_SCENES: Array<[prefix: string, scene: Scene]> = [
  // ---- Street Ops / crime ----
  ['/crimes', CRIME],
  ['/heists', CRIME],
  ['/street-dealer', CRIME],
  ['/drug-lab', CRIME],
  ['/drug-marketplace', CRIME],
  ['/weed-grow', CRIME],
  ['/murder', CRIME],
  ['/detective', CRIME],
  ['/arsenal', CRIME],
  ['/metal-factory', CRIME],
  ['/red-light', CRIME],
  ['/jail', CRIME],
  ['/most-wanted', CRIME],
  ['/crime-leaderboard', CRIME],
  ['/reputations/powerrip', CRIME],

  // ---- Casino ----
  ['/casino', CASINO],

  // ---- Money / economy ----
  ['/bank', BANK],
  ['/transactions', BANK],
  ['/laundering', BANK],
  ['/stocks', BANK],
  ['/marketplace', BANK],
  ['/real-estate', BANK],
  ['/post-office', BANK],
  ['/shop', BANK],
  ['/reputations/tax-bank', BANK],
  ['/families/bank', BANK],
  ['/families/donations', BANK],
];

/** Everything not listed above (dashboard, family, profile, journey, ...). */
export const DEFAULT_SCENE = CITY;

export function sceneForPath(pathname: string): Scene {
  let best: Scene = DEFAULT_SCENE;
  let bestLen = 0;
  for (const [prefix, scene] of ROUTE_SCENES) {
    if ((pathname === prefix || pathname.startsWith(prefix + '/')) && prefix.length > bestLen) {
      best = scene;
      bestLen = prefix.length;
    }
  }
  return best;
}
