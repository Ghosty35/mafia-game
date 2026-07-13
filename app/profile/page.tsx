'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';

export default function ProfilePage() {
  const { player } = usePlayer();
  const searchParams = useSearchParams();
  const viewUser = searchParams.get('user') || searchParams.get('username');

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = createClient();

      try {
        if (viewUser) {
          // Try to find by username (simple public lookup)
          const { data: found } = await supabase
            .from('players')
            .select('id, username, level, cash, diamonds, is_donator, crimes_succeeded, crimes_failed, family_id, power, protection, health, murder_skill')
            .ilike('username', viewUser)
            .limit(1)
            .single();

          if (found) {
            setProfile(found);
          } else {
            setError('Player not found.');
          }
        } else if (player) {
          // Show own full profile
          setProfile(player);
        }
      } catch (e: any) {
        setError('Failed to load profile.');
      }
      setLoading(false);
    };
    load();
  }, [viewUser, player]);

  if (loading) return <div className="p-8">Loading profile...</div>;

  const p = profile || player;
  if (!p) return <div className="p-8">No player data. <Link href="/dashboard">Go back</Link></div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">👤 Profile</h1>
      <p className="text-zinc-400 mb-6">{p.username || 'Unknown'} {p.is_donator && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-500 text-black rounded">DONATOR</span>}</p>

      {error && <div className="text-red-400 mb-4">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <div className="text-xs text-zinc-500">LEVEL &amp; PROGRESS</div>
          <div className="text-2xl font-bold">{p.level}</div>
          <div className="text-sm mt-1">XP: {p.xp || 0}</div>
          <div>Health: {p.health || 100}</div>
          <div>Murder Skill: {(p.murder_skill || 0).toFixed(2)}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">WEALTH</div>
          <div>Cash: <span className="font-mono">${(p.cash || 0).toLocaleString()}</span></div>
          <div>Bank: <span className="font-mono">${(p.personal_bank || 0).toLocaleString()}</span></div>
          <div>Diamonds: <span className="font-mono">{p.diamonds || 0} 💎</span></div>
          <div>Power: {p.power || 0}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">CRIMINAL RECORD</div>
          <div>Crimes Succeeded: {p.crimes_succeeded || 0}</div>
          <div>Crimes Failed: {p.crimes_failed || 0}</div>
          <div>Heat: {p.heat || 0}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">STATUS</div>
          <div>Donator: {p.is_donator ? '✅ YES' : 'No'}</div>
          {p.donator_since && <div className="text-xs">Since: {new Date(p.donator_since).toLocaleDateString()}</div>}
          <div>Protection: {p.protection || 0}</div>
          <div>Bullets: {p.bullets || 0}</div>
        </div>
      </div>

      <div className="text-xs text-zinc-500">
        Full detailed profile with family history, owned properties, and more coming soon.
        <br />
        <Link href="/families" className="text-red-400">← Back to Families</Link> • <Link href="/dashboard" className="text-red-400">Dashboard</Link>
      </div>
    </div>
  );
}
