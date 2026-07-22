// Per-section background art. Each area of the game gets its own scene so
// the world changes as you move around it, instead of one flat image
// everywhere. Keyed by route prefix, longest match wins.
//
// In-game art is a neon-cyberpunk set (user-supplied StockCake stock, free
// for commercial use). The login/register pages deliberately keep their own
// noir harbour look and are NOT driven by this map.

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

const CITY: Scene = { src: '/bg-neon-city.webp', scrim: 0.74 };
const STREETS: Scene = { src: '/bg-neon-streets.webp', scrim: 0.76 };
const ALLEY: Scene = { src: '/bg-neon-alley.webp', scrim: 0.74 };
const DETECTIVE: Scene = { src: '/bg-neon-detective.webp', scrim: 0.62 }; // already very dark
const CASINO: Scene = {
  src: '/bg-neon-casino.webp',
  scrim: 0.76,
  character: { src: '/char-cards.webp', opacity: 0.5 },
};
const VAULT: Scene = { src: '/bg-neon-vault.webp', scrim: 0.74 };
const ATM: Scene = { src: '/bg-neon-atm.webp', scrim: 0.76 };
const MARKET: Scene = { src: '/bg-neon-market.webp', scrim: 0.76 };
const GARAGE: Scene = { src: '/bg-neon-garage.webp', scrim: 0.74 };
const TUNESHOP: Scene = { src: '/bg-neon-tuneshop.webp', scrim: 0.76 };
const GYM: Scene = { src: '/bg-neon-gym.webp', scrim: 0.74 };
const JAIL: Scene = { src: '/bg-neon-jail.webp', scrim: 0.72 };
const HOSPITAL: Scene = { src: '/bg-neon-hospital.webp', scrim: 0.74 };
const DRUGLAB: Scene = { src: '/bg-neon-druglab.webp', scrim: 0.76 };
const WEED: Scene = { src: '/bg-neon-weed.webp', scrim: 0.74 };
// Uses the plain neon alley rather than the 'girl Avatar' shot: that image
// has a figure standing centre-frame, exactly where the UI cards land.
const REDLIGHT: Scene = { src: '/bg-neon-alley.webp', scrim: 0.76 };
const FAMILY: Scene = { src: '/bg-neon-family.webp', scrim: 0.74 };
const ARSENAL: Scene = { src: '/bg-neon-arsenal.webp', scrim: 0.72 };
const FOUNDRY: Scene = { src: '/bg-neon-foundry.webp', scrim: 0.76 };
const AUCTION: Scene = { src: '/bg-neon-auction.webp', scrim: 0.78 }; // busy, needs more cover
const RACE: Scene = { src: '/bg-neon-race.webp', scrim: 0.74 };
const FINANCE: Scene = { src: '/bg-neon-finance.webp', scrim: 0.78 };
const SKYLINE: Scene = { src: '/bg-neon-skyline.webp', scrim: 0.74 };
const TRAVEL: Scene = { src: '/bg-neon-travel.webp', scrim: 0.78 };
const STREET2: Scene = { src: '/bg-neon-street2.webp', scrim: 0.76 };

/** Route prefix -> scene. Order does not matter; the longest prefix wins. */
const ROUTE_SCENES: Array<[prefix: string, scene: Scene]> = [
  // ---- Street Ops / crime ----
  ['/crimes', STREETS],
  ['/heists', ALLEY],
  ['/murder', ALLEY],
  ['/arsenal', ARSENAL],
  ['/metal-factory', FOUNDRY],
  ['/race', RACE],
  ['/most-wanted', STREET2],
  ['/crime-leaderboard', STREET2],
  ['/reputations/powerrip', STREET2],
  ['/detective', DETECTIVE],
  ['/street-dealer', WEED],
  ['/drug-marketplace', WEED],
  ['/weed-grow', WEED],
  ['/drug-lab', DRUGLAB],
  ['/red-light', REDLIGHT],

  // ---- Casino ----
  ['/casino', CASINO],

  // ---- Money / economy ----
  ['/bank', VAULT],
  ['/laundering', VAULT],
  ['/reputations/tax-bank', VAULT],
  ['/families/bank', VAULT],
  ['/families/donations', VAULT],
  ['/transactions', ATM],
  ['/post-office', ATM],
  ['/stocks', FINANCE],
  ['/marketplace', AUCTION],
  ['/real-estate', SKYLINE],
  ['/shop', MARKET],

  // ---- City services ----
  ['/garage', GARAGE],
  ['/garage/tune-shop', TUNESHOP],
  ['/garage/junkyard', TUNESHOP],
  ['/gym', GYM],
  ['/jail', JAIL],
  ['/hospital', HOSPITAL],
  ['/travel', TRAVEL],

  // ---- Family ----
  ['/families', FAMILY],
  ['/territories', FAMILY],
];

/** Everything not listed above (dashboard, profile, journey, ...). */
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
