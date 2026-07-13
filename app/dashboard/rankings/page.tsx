import { redirect } from 'next/navigation';

export default async function RankingsPage() {
  // Redirect to the main standalone Leaderboard
  redirect('/leaderboard');
}
