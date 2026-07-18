'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Player } from '@/lib/types';

export type ToastKind = 'success' | 'fail' | 'error' | 'info' | 'levelup';
export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface PlayerContextType {
  player: Player | null;
  refreshPlayer: () => Promise<void>;
  updatePlayer: (newPlayer: Player) => void;
  canPerformAction: () => boolean;
  recordAction: () => void;
  lastActionTime: number;
  toast: Toast | null;
  showToast: (text: string, kind?: ToastKind) => void;
  dismissToast: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [lastActionTime, setLastActionTime] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (text: string, kind: ToastKind = 'info') => {
    setToast({ id: Date.now(), text, kind });
  };
  const dismissToast = () => setToast(null);

  const refreshPlayer = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.rpc('get_my_player');
    if (data) {
      const p = data as Player;
      if (p.death_until && new Date(p.death_until).getTime() <= Date.now()) {
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

  const initialMountRef = useRef(true);

  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      refreshPlayer();
    }
  }, []);

  // Auto-refresh player data every 15 seconds across all pages (keeps live stats, cooldowns, etc. fresh)
  useEffect(() => {
    const interval = setInterval(async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) refreshPlayer();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        player,
        refreshPlayer,
        updatePlayer,
        canPerformAction,
        recordAction,
        lastActionTime,
        toast,
        showToast,
        dismissToast,
      }}
    >
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
