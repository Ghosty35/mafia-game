import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CooldownRow, Crime, Player } from '@/lib/types';
import dynamicImport from 'next/dynamic';

const CrimesClient = dynamicImport(() => import('./CrimesClient'), {
  loading: () => (
    <div className="p-8 text-zinc-400">Loading crime status...</div>
  ),
});

export const dynamic = 'force-dynamic';

export default async function CrimesPage() {
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
    <CrimesClient
      initialPlayer={(player as Player) ?? null}
      crimes={(crimes as Crime[]) ?? []}
      initialCooldowns={(cooldowns as CooldownRow[]) ?? []}
    />
  );
}
