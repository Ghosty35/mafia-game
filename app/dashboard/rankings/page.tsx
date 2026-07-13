import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { LeaderboardData } from '@/lib/types';
import RankingsClient from './RankingsClient';

export default async function RankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data, error } = await supabase.rpc('get_leaderboard');

  if (error) {
    console.error('get_leaderboard failed:', error.message);
  }

  return (
    <RankingsClient
      leaderboard={(data as LeaderboardData) ?? { top: [], me: null }}
      loadError={!!error}
    />
  );
}
