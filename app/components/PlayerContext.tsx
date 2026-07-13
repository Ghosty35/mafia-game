'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Player } from '@/lib/types';

interface PlayerContextType {
  player: Player | null;
  refreshPlayer: () => Promise<void>;
  updatePlayer: (newPlayer: Player) => void;
  canPerformAction: () => boolean;
  recordAction: () => void;
  lastActionTime: number;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [lastActionTime, setLastActionTime] = useState(0);

  const refreshPlayer = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_my_player');
    if (data) {
      let p = data as Player;
      // Admin override for YGhosty - no restrictions, high stats for testing.
      // Cash is kept real so that bank transfers, deposits, withdrawals persist correctly in DB.
      // Display will boost it for admin in PlayerInfoCard.
      if (p.username === 'YGhosty') {
        p = {
          ...p,
          // cash left as real value from DB
          power: Math.max(p.power || 0, 50000),
          level: Math.max(p.level || 0, 50), // Godfather
          murder_skill: Math.max(p.murder_skill || 0, 15), // ~75%
          is_donator: true,
        };
      }
      // Basic client-side death check / respawn
      if (p.death_until && new Date(p.death_until).getTime() <= Date.now()) {
        // Respawn with 1% health
        const updated = { ...p, health: 1, death_until: null, kill_protected_until: null };
        setPlayer(updated as Player);
        // In real, call a respawn RPC
      } else {
        setPlayer(p);
      }
    }
  };

  const updatePlayer = (newPlayer: Player) => {
    setPlayer(newPlayer);
  };

  const canPerformAction = () => {
    return Date.now() - lastActionTime >= 2000;
  };

  const recordAction = () => setLastActionTime(Date.now());

  useEffect(() => {
    refreshPlayer();
  }, []);

  // Auto-refresh player data every 15 seconds across all pages (keeps live stats, cooldowns, etc. fresh)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPlayer();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <PlayerContext.Provider value={{ player, refreshPlayer, updatePlayer, canPerformAction, recordAction, lastActionTime }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
