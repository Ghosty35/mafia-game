import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Player } from '@/lib/types';
import DashboardClient from './DashboardClient';

// Server component: checks login, loads player stats, crimes and
// active cooldown timers.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: player, error: playerError } = await supabase.rpc('get_my_player');

  if (playerError) {
    console.error('get_my_player error:', playerError);
  }

  return (
    <DashboardClient
      initialPlayer={(player as Player) ?? null}
      playerError={playerError}
    />
  );
}
