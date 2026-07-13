import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CooldownRow, Crime, Player } from '@/lib/types';
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

  const [{ data: player, error: playerError }, { data: crimes }, { data: cooldowns }] =
    await Promise.all([
      supabase.rpc('get_my_player'),
      supabase.from('crimes').select('*').order('sort_order'),
      supabase.from('crime_cooldowns').select('*'),
    ]);

  if (playerError) {
    console.error('get_my_player failed:', playerError.message);
  }

  return (
    <DashboardClient
      email={user.email ?? ''}
      initialPlayer={(player as Player) ?? null}
      crimes={(crimes as Crime[]) ?? []}
      initialCooldowns={(cooldowns as CooldownRow[]) ?? []}
    />
  );
}
