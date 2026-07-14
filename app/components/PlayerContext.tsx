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
      const p = data as Player;
      // NOTE: the old client-side stat inflation for YGhosty was removed —
      // it made components disagree with the DB (tracker desync). Admin
      // stats are now persisted server-side by migration 035.
      if (p.death_until && new Date(p.death_until).getTime() <= Date.now()) {
        // Death timer expired: respawn server-side, then re-fetch the real row
        await supabase.rpc('check_and_respawn');
        const { data: fresh } = await supabase.rpc('get_my_player');
        setPlayer((fresh as Player) || { ...p, health: 1, death_until: null, kill_protected_until: null });
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
