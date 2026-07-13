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
  crimes_succeeded: number;
  crimes_failed: number;
  rebirths: number;
  family_id?: string | null;   // NEW: link to Families (added in migration 008)
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

// One row from get_leaderboard() — no cash or email exposed
export type LeaderboardEntry = {
  pos: number;
  username: string;
  level: number;
  rebirths: number;
  crimes: number;
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
