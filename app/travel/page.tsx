'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CITIES, City } from '@/lib/cities';
import { usePlayer } from '../components/PlayerContext';

export default function TravelPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const currentCity = (player?.current_city as City) || 'New York';

  const travelTo = async (city: City) => {
    if (!player || city === currentCity) return;

    setBusy(true);
    setMessage('');

    const supabase = createClient();

    // Cost is enforced server-side ($380)
    const { data, error } = await supabase.rpc('travel_to_city', { city });

    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash to travel!' : (error.message || 'Travel failed.'));
    } else {
      await refreshPlayer();
      setMessage(`Traveled to ${city} for $${data?.cost || 380}.`);
    }

    setBusy(false);
  };

  if (!player) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🚂 Train Station</h1>
      <p className="text-sm text-zinc-400 mb-6">Current location: <strong>{currentCity}</strong></p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CITIES.map(city => (
          <div key={city} className="card p-5">
            <h3 className="font-bold text-lg mb-2">{city}</h3>
            <p className="text-xs text-zinc-500 mb-3">Travel cost: $380 (instant)</p>
            <button
              onClick={() => travelTo(city)}
              disabled={busy || city === currentCity}
              className="w-full py-2 bg-red-700 hover:bg-red-600 rounded disabled:opacity-50"
            >
              {city === currentCity ? 'You are here' : `Travel to ${city}`}
            </button>
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
