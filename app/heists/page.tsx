import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HeistsClient from './HeistsClient';

export default async function HeistsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: player } = await supabase.rpc('get_my_player');

  return <HeistsClient initialPlayer={player} />;
}
