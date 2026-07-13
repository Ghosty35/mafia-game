import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import DashboardClient from './DashboardClient';

type FamilyStatus = {
  family_id: string | null;
  family_name: string | null;
  family_tag: string | null;
  family_respect: number | null;
  my_role: string | null;
};

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

  const [{ data: player, error: playerError }, { data: familyStatus }] =
    await Promise.all([
      supabase.rpc('get_my_player'),
      supabase.rpc('get_my_family_status'),
    ]);

  if (playerError) {
    // Silent in production; player will see error state
  }

  return (
    <DashboardClient
      email={user.email ?? ''}
      initialPlayer={(player as Player) ?? null}
      familyStatus={(familyStatus as FamilyStatus) ?? null}
    />
  );
}
