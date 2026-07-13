import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SingleCrimeView from '../SingleCrimeView';

export default async function StealCarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <SingleCrimeView crimeKey="steal_car" />;
}
