'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type FamilySummary = {
  id: string;
  name: string;
  tag: string;
  respect: number;
  territory: number;
  member_count: number;
};

type MyFamilyData = {
  family: any | null;
  my_role: string | null;
  members: any[];
};

export default function FamiliesPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [myFamily, setMyFamily] = useState<MyFamilyData | null>(null);
  const [availableFamilies, setAvailableFamilies] = useState<FamilySummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const supabase = createClient();

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [myFamRes, listRes] = await Promise.all([
        supabase.rpc('get_my_family'),
        supabase.rpc('list_families'),
      ]);

      if (myFamRes.error) console.error(myFamRes.error);
      if (listRes.error) console.error(listRes.error);

      setMyFamily(myFamRes.data || { family: null, my_role: null, members: [] });

      // list_families returns jsonb array or null
      const families = listRes.data ? (Array.isArray(listRes.data) ? listRes.data : []) : [];
      setAvailableFamilies(families);
    } catch (e: any) {
      console.error(e);
      setError('Failed to load families data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const { error } = await supabase.rpc('create_family', {
      p_name: newName,
      p_tag: newTag,
      p_description: newDesc || null,
    });

    setBusy(false);

    if (error) {
      let msg = 'Failed to create family.';
      if (error.message.includes('ALREADY_IN_FAMILY')) msg = 'You are already in a Family.';
      if (error.message.includes('FAMILY_NAME_TAKEN')) msg = 'That Family name is taken.';
      if (error.message.includes('FAMILY_TAG_TAKEN')) msg = 'That tag is already in use.';
      if (error.message.includes('INVALID_FAMILY_NAME')) msg = 'Name must be 3-32 characters.';
      if (error.message.includes('INVALID_FAMILY_TAG')) msg = 'Tag must be 2-5 characters.';
      if (error.message.includes('NO_USERNAME')) msg = 'You must set a gangster name first.';
      setError(msg);
      return;
    }

    // Success — reset and reload
    setNewName('');
    setNewTag('');
    setNewDesc('');
    setShowCreate(false);
    await loadData();
  };

  const joinFamily = async (familyId: string) => {
    setBusy(true);
    setError(null);

    const { error } = await supabase.rpc('join_family', { p_family_id: familyId });

    setBusy(false);

    if (error) {
      let msg = 'Could not join this Family.';
      if (error.message.includes('ALREADY_IN_FAMILY')) msg = 'You are already in a Family.';
      setError(msg);
      return;
    }

    await loadData();
  };

  const leaveFamily = async () => {
    if (!confirm('Are you sure you want to leave your Family?')) return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.rpc('leave_family');

    setBusy(false);

    if (error) {
      setError('Failed to leave Family.');
      return;
    }

    await loadData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white p-6 flex items-center justify-center">
        <div className="text-zinc-400">Loading the underworld...</div>
      </div>
    );
  }

  const inFamily = !!myFamily?.family;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-5xl font-bold text-red-500 tracking-wider">FAMILIES</h1>
            <p className="text-zinc-400 mt-1">The criminal organizations that run the city</p>
          </div>
          <Link href="/families/leaderboard" className="text-red-400 hover:text-red-300 font-semibold">
            View Families Leaderboard →
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-950/60 border border-red-800 text-red-300 px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        {/* Current Family Section */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-bold mb-4">Your Family</h2>

          {inFamily && myFamily?.family ? (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-5xl">👑</div>
                <div>
                  <div className="text-3xl font-bold">{myFamily.family.name}</div>
                  <div className="text-red-400 font-mono text-lg tracking-[3px]">{myFamily.family.tag}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm text-zinc-400">Your Role</div>
                  <div className="font-bold capitalize text-amber-400">{myFamily.my_role}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6 text-center">
                <div className="bg-zinc-950 p-4 rounded-xl">
                  <div className="text-xs text-zinc-500">RESPECT</div>
                  <div className="text-2xl font-semibold text-amber-400">{myFamily.family.respect}</div>
                </div>
                <div className="bg-zinc-950 p-4 rounded-xl">
                  <div className="text-xs text-zinc-500">TERRITORY</div>
                  <div className="text-2xl font-semibold text-emerald-400">{myFamily.family.territory}</div>
                </div>
                <div className="bg-zinc-950 p-4 rounded-xl">
                  <div className="text-xs text-zinc-500">MEMBERS</div>
                  <div className="text-2xl font-semibold">{myFamily.family.member_count}</div>
                </div>
              </div>

              <div className="mb-4">
                <div className="text-sm text-zinc-400 mb-2">Members</div>
                <div className="bg-zinc-950 rounded-xl p-4 text-sm space-y-1 max-h-40 overflow-auto">
                  {myFamily.members?.length ? (
                    myFamily.members.map((m: any, i: number) => (
                      <div key={i} className="flex justify-between">
                        <span>{m.username}</span>
                        <span className="text-zinc-500 capitalize">{m.role}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500">No members data</div>
                  )}
                </div>
              </div>

              <button
                onClick={leaveFamily}
                disabled={busy}
                className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm disabled:opacity-50"
              >
                Leave Family
              </button>
            </div>
          ) : (
            <div>
              <p className="text-zinc-400 mb-6">You are not currently in a Family.</p>

              {!showCreate ? (
                <button
                  onClick={() => setShowCreate(true)}
                  className="bg-red-600 hover:bg-red-500 px-8 py-3 rounded-xl font-semibold"
                >
                  Create Your Family
                </button>
              ) : (
                <form onSubmit={createFamily} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Family Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="The Corleone Family"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5"
                      required
                      maxLength={32}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Tag (2-5 letters)</label>
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value.toUpperCase())}
                      placeholder="CORL"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 font-mono"
                      required
                      maxLength={5}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Description (optional)</label>
                    <textarea
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5"
                      rows={2}
                      maxLength={200}
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={busy || !newName || !newTag}
                      className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 py-3 rounded-xl font-semibold"
                    >
                      {busy ? 'Creating...' : 'Create Family'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="px-6 border border-zinc-700 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Browse Families */}
        {!inFamily && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Browse Families</h2>
            {availableFamilies.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 text-center text-zinc-400">
                No Families have been founded yet. Be the first!
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {availableFamilies.map((fam) => (
                  <div key={fam.id} className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 flex flex-col">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-bold text-xl">{fam.name}</div>
                        <div className="text-red-400 font-mono tracking-widest">{fam.tag}</div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-amber-400 font-semibold">{fam.respect} Respect</div>
                        <div className="text-emerald-400">{fam.member_count} members</div>
                      </div>
                    </div>

                    <button
                      onClick={() => joinFamily(fam.id)}
                      disabled={busy}
                      className="mt-auto w-full bg-zinc-800 hover:bg-red-600 hover:text-white transition-colors py-2.5 rounded-xl font-semibold disabled:opacity-50"
                    >
                      Join Family
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-10 text-center text-xs text-zinc-500">
          Families gain Respect and Territory through crimes, wars, and territory control (coming soon).
        </div>
      </div>
    </div>
  );
}
