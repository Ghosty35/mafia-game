import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BankClient from './BankClient';

export default async function BankPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: player } = await supabase.rpc('get_my_player');

  return <BankClient initialPlayer={player} />;
}
