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

  const playerErrorSerialized = playerError
    ? { message: (playerError as { message?: string }).message ?? 'Unknown error', code: (playerError as { code?: string }).code ?? null, details: (playerError as { details?: string }).details ?? null, hint: (playerError as { hint?: string }).hint ?? null }
    : null;

  return (
    <DashboardClient
      initialPlayer={(player as Player) ?? null}
      playerError={playerErrorSerialized}
    />
  );
}
