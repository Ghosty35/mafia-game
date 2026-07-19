import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import SingleCrimeClient from './[key]/SingleCrimeClient';

// Shared by every /crimes/<key> route (both the dynamic [key] page and the
// older static pickpocket/rob_store/steal_car/bank_heist folders) so there
// is exactly one implementation of the single-crime UI to fix bugs in.
export async function renderSingleCrime(crimeKey: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [{ data: player }, { data: allCrimes }, { data: cooldowns }, { data: familyStatus }] =
    await Promise.all([
      supabase.rpc('get_my_player'),
      supabase.from('crimes').select('*').order('sort_order'),
      supabase.from('crime_cooldowns').select('*'),
      supabase.rpc('get_my_family_status'),
    ]);

  const crime = (allCrimes as Crime[] | null)?.find((c) => c.key === crimeKey);

  if (!crime) {
    redirect('/crimes');
  }

  return (
    <SingleCrimeClient
      initialPlayer={(player as Player) ?? null}
      crime={crime}
      initialCooldowns={(cooldowns as CooldownRow[]) ?? []}
      familyStatus={(familyStatus as unknown) ?? null}
    />
  );
}
