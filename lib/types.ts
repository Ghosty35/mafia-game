// One entry in the owned_properties jsonb array on players
export type OwnedProperty = {
  id: string;
  name: string;
  type: string;
  city: string;
  purchase_date: string;
  bank_balance: number;
  maintenance_due: number;
  autopay: boolean;
  shed_level?: number;      // 1-3, storage upgrades
  income?: number;          // base income per hour
  earnings_week?: number;   // weekly earnings tracker (pre-tax)
  last_earned?: string;     // ISO timestamp of last earnings tick
  piggy_bank?: number;      // Mansion only: hidden safe
  bodyguards?: number;      // Villa only: raid protection (0-10)
  spots?: number;           // weed grow spots
};

// Matches the public.players table in Supabase
export type Player = {
  id: string;
  username: string | null;
  cash: number;
  diamonds: number;
  level: number;
  xp: number;
  created_at: string;
  jailed_until: string | null;
  heat: number;
  crimes_succeeded: number;
  crimes_failed: number;
  rebirths: number;
  family_id?: string | null;   // NEW: link to Families (added in migration 008)
  health: number;              // 0-100
  murder_skill: number;        // KillSkill / Murder experience points (0.02 per success)
  power: number;               // Total power (buyable in weapon shop later)
  protection: number;          // Reduces health loss from crimes/heists
  personal_bank: number;       // Personal bank balance (protected cash)
  current_city: string;        // Current city for travel system
  death_until: string | null;  // If set, player is dead until this time
  kill_protected_until: string | null; // Protected from PvP kills
  bullets: number;             // Ammo for murder/PvP
  leaderboard_rank?: number;   // Current global rank
  drug_storage?: Record<string, number>; // KGs for each drug
  weed_progress?: number;      // 0-5 for watering
  murder_cooldown?: string;    // ISO for cooldown
  owned_properties?: OwnedProperty[];
  money_rank?: string;
  total_wealth?: number;
  last_active?: string;            // for online / server status
  transaction_log?: Array<any>;    // last transactions
  autopay_bills?: boolean;
  bill_history?: Array<any>;
  total_taxes?: number;
  // Cooldowns sometimes attached to player or separate
  heist_cooldown?: string | null;
  crime_cooldowns?: Record<string, string>;
  energy?: number;
  max_energy?: number;
  // Garage / cars from 028
  cars?: Array<any>;
  garage_level?: number;
  // Donator / VIP status (030)
  is_donator?: boolean;
  donator_since?: string;
  breakout_skill?: number;  // for jail breakout training
  gov_tax_bank?: number;    // Gov Tax fund contributions
  stock_holdings?: Record<string, number>;  // ticker -> shares
  // Weed harvest lifetime stats
  successful_harvest_kg?: number;
  failed_harvest_kg?: number;
  weed_plants?: Record<string, any>;  // { quality: number } — grow quality persists here
  // Profile customization (Bulletstar style)
  avatar_url?: string;
  bio?: string;
  // Bills / taxes aggregated on player
  maintenance_due?: number;
  earnings_week?: number;
  // Language preference (037) — 'en' | 'nl'
  language?: string;
};

// Matches the public.crimes table in Supabase
export type Crime = {
  key: string;
  min_level: number;
  min_reward: number;
  max_reward: number;
  success_chance: number;
  xp_success: number;
  jail_seconds: number;
  cooldown_seconds: number;
  sort_order: number;
};

// Matches the public.crime_cooldowns table in Supabase
export type CooldownRow = {
  player_id: string;
  crime_key: string;
  available_at: string;
};

// One row from get_leaderboard()
export type LeaderboardEntry = {
  pos: number;
  username: string;
  level: number;
  rebirths: number;
  crimes: number;
  cash: number;
  family_tag: string | null;
  family_name: string | null;
};

// What get_leaderboard() returns
export type LeaderboardData = {
  top: LeaderboardEntry[];
  me: LeaderboardEntry | null;
};

// What commit_crime() returns
export type CrimeResult = {
  success: boolean;
  reward: number;
  xp_gained: number;
  leveled_up: boolean;
  available_at: string;
  player: Player;
  family_respect_gained?: number;
  in_family?: boolean;
  health_lost?: number;
  murder_skill_gained?: number;
};

// =====================
// FAMILIES (Mafia Families)
// =====================

export type Family = {
  id: string;
  name: string;
  tag: string;
  description: string | null;
  respect: number;
  territory: number;
  wars_won: number;
  member_count: number;
  bank: number;
  power?: number;           // NEW: family power (attack/def + hourly)
  created_at: string;
};

export type FamilyLeaderboardEntry = {
  pos: number;
  id: string;
  name: string;
  tag: string;
  respect: number;
  territory: number;
  wars_won: number;
  member_count: number;
};

export type FamiliesLeaderboardData = {
  top: FamilyLeaderboardEntry[];
};

// Optional: extended player with family info
export type PlayerWithFamily = Player & {
  family_id: string | null;
  family?: Family | null;
};
