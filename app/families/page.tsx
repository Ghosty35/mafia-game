'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';
import React from 'react';

type FamilySummary = {
  id: string;
  name: string;
  tag: string;
  respect: number;
  territory: number;
  member_count: number;
};

type FamilyMember = {
  player_id: string;
  username: string | null;
  role: string;
};

type MyFamilyData = {
  family: {
    id: string;
    name: string;
    tag: string;
    respect: number;
    territory: number;
    member_count: number;
    bank: number;
    power?: number;
    pending_bank?: number;
  } | null;
  my_role: string | null;
  members: FamilyMember[];
  bank?: number;
  pending_bank?: number;
  pending_donations?: Array<{
    id: string;
    username: string | null;
    amount: number;
    donated_at: string;
  }>;
};

export const dynamic = 'force-dynamic';

export default function FamiliesPage() {
  const { t } = useLanguage();
  const { player, updatePlayer, refreshPlayer } = usePlayer();  // need player for level/cash/diamonds checks + updates
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [myFamily, setMyFamily] = useState<MyFamilyData | null>(null);
  const [availableFamilies, setAvailableFamilies] = useState<FamilySummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addLogLocal = (m: string) => { console.log('[FAMILY]', m); /* could show toast */ };

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

      if (myFamRes.error) {
        // Handled by error state
      }
      if (listRes.error) {
        // Handled by error state
      }

      setMyFamily(myFamRes.data || { family: null, my_role: null, members: [] });

      // list_families returns jsonb array or null
      const families = listRes.data ? (Array.isArray(listRes.data) ? listRes.data : []) : [];
      setAvailableFamilies(families);
    } catch (e: any) {
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

    // Refresh player first to avoid stale cash/diamonds from context
    if (refreshPlayer) await refreshPlayer();

    if (!player) {
      setError('Player not loaded.');
      setBusy(false);
      return;
    }
    if (player.level < 10 && !player.is_donator) {
      setError('Need at least level 10 (Hitman rank area) to create a family. Donators can create at any rank with diamonds.');
      setBusy(false);
      return;
    }

    // Let the RPC handle funds validation (2M cash or 25 diamonds) and deduction.
    // Client check above can be stale, so we always attempt and show precise RPC error.
    const { error } = await supabase.rpc('create_family', {
      p_name: newName,
      p_tag: newTag,
      p_description: newDesc || null,
    });

    setBusy(false);

    if (error) {
      let msg = 'Failed to create family.';
      const em = error.message || '';
      if (em.includes('ALREADY_IN_FAMILY')) msg = 'You are already in a Family.';
      else if (em.includes('FAMILY_NAME_TAKEN')) msg = 'That Family name is taken.';
      else if (em.includes('FAMILY_TAG_TAKEN')) msg = 'That tag is already in use.';
      else if (em.includes('INVALID_FAMILY_NAME')) msg = 'Name must be 3-32 characters.';
      else if (em.includes('INVALID_FAMILY_TAG')) msg = 'Tag must be 2-5 characters.';
      else if (em.includes('NO_USERNAME')) msg = 'You must set a gangster name first.';
      else if (em.includes('INSUFFICIENT_FUNDS')) msg = 'Not enough funds: need 2,000,000 cash or 25 diamonds.';
      else if (em.includes('LEVEL_TOO_LOW')) msg = 'Need at least level 10 (Hitman rank area) to create a family. Donators can create at any rank with diamonds.';
      else if (em) msg = `Failed to create family: ${em}`;
      setError(msg);
      return;
    }

    // Success — reset and reload + sync player cash/diamonds
    setNewName('');
    setNewTag('');
    setNewDesc('');
    setShowCreate(false);
    await loadData();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
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

  // Role management - role aware (Boss, Underboss, Manager per your specs)
  const changeRole = async (playerId: string, newRole: string, action: 'promote' | 'demote') => {
    if (!confirm(`Are you sure you want to ${action} this member to ${newRole}?`)) return;

    setBusy(true);
    setError(null);

    const rpcName = action === 'promote' ? 'promote_member' : 'demote_member';
    const { error } = await supabase.rpc(rpcName, {
      p_target_player_id: playerId,
      p_new_role: newRole,
    });

    setBusy(false);

    if (error) {
      let msg = `Failed to ${action} member.`;
      if (error.message.includes('NOT_AUTHORIZED')) msg = 'You do not have permission to manage this role.';
      if (error.message.includes('MAX_2_MANAGERS')) msg = 'Maximum 2 Managers allowed per Family.';
      if (error.message.includes('MANAGERS_CAN_ONLY')) msg = 'Managers can only assign lower member roles.';
      setError(msg);
      return;
    }

    await loadData();
  };

  const isBoss = myFamily?.my_role === 'boss';
  const isUnderboss = myFamily?.my_role === 'underboss';
  const isAccountant = myFamily?.my_role === 'accountant';
  const isManager = myFamily?.my_role === 'manager';

  // Permissions based on your specs - true family leadership tools
  const canManageMembers = isBoss || isUnderboss || isManager;
  const canKick = isBoss || isUnderboss; // Underboss can kick like boss for family matters
  const canAcceptDonations = isBoss || isUnderboss || isAccountant;
  const canManageFamilySettings = isBoss || isUnderboss; // Underboss almost full for family settings
  const canSeeBank = true; // visible to all in family, full control for higher

  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [donationAmount, setDonationAmount] = useState(100);
  const [activeTab, setActiveTab] = useState<'members' | 'donations'>(tabParam === 'banking' ? 'donations' : 'members');

  const donate = async () => {
    if (!donationAmount || donationAmount <= 0) return;

    if (!confirm(`Confirm donation of $${donationAmount} to the family pending bank? This will be reviewed by leadership.`)) {
      return;
    }

    setBusy(true);
    setError(null);

    const { data, error } = await supabase.rpc('donate_to_family', {
      amount: donationAmount,
    });

    setBusy(false);

    if (error) {
      setError(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash to donate.' : 'Donation failed.');
      return;
    }

    // Refresh
    await loadData();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setDonationAmount(100);
  };

  const kickMember = async (playerId: string, username: string | null) => {
    if (!confirm(`Are you sure you want to kick ${username || 'this member'} from the Family?`)) return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.rpc('kick_member', {
      p_target_player_id: playerId,
    });

    setBusy(false);

    if (error) {
      setError(error.message.includes('NOT_AUTHORIZED') ? 'Only Boss or Underboss can kick members.' : 'Failed to kick member.');
      return;
    }

    await loadData();
  };

  const acceptDonation = async (donationId: string) => {
    setBusy(true);
    setError(null);

    const { error } = await supabase.rpc('accept_pending_donation', {
      donation_id: donationId,
    });

    setBusy(false);

    if (error) {
      setError('Failed to accept donation. Only Accountant, Boss or Underboss can accept.');
      return;
    }

    await loadData();
  };

  const availableRolesForPromotion = ['underboss', 'accountant', 'manager', 'caporegime', 'soldier', 'associate'];

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white p-6 flex items-center justify-center">
        <div className="text-zinc-400">Loading the underworld...</div>
      </div>
    );
  }

  const inFamily = !!myFamily?.family;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
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
          <p className="text-xs text-zinc-400 mb-4">The Family Table: Treasury, Crew Management, Operations. All the tools a real boss needs.</p>

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

              <div className="grid grid-cols-4 gap-3 mb-5 text-center">
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">RESPECT</div>
                  <div className="text-xl font-semibold text-amber-400 tabular-nums">{myFamily.family.respect}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">POWER</div>
                  <div className="text-xl font-semibold text-orange-400 tabular-nums">{myFamily.family.power || 0}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">TERRITORY</div>
                  <div className="text-xl font-semibold text-emerald-400 tabular-nums">{myFamily.family.territory}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">MEMBERS</div>
                  <div className="text-xl font-semibold tabular-nums">{myFamily.family.member_count}</div>
                </div>
              </div>

              {/* Family Power indicators */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">FAMILY BANK</div>
                  <div className="text-xl font-bold text-emerald-400 tabular-nums">
                    ${(myFamily.family.bank ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl">
                  <div className="text-[10px] text-zinc-500">PENDING BANK</div>
                  <div className="text-xl font-bold text-yellow-400 tabular-nums">
                    ${(myFamily.family.pending_bank ?? myFamily.pending_bank ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* NEW: Family Power + Hourly Pay System (core request) */}
              <FamilyPowerHourlySection 
                myFamily={myFamily} 
                onRefresh={loadData} 
                canManagePower={isBoss || isUnderboss || isAccountant}
              />

              <div className="text-xs bg-zinc-950/70 border border-zinc-800 px-3 py-2 rounded-lg text-zinc-400 mb-4">
                Donate → Leaders buy Power (using family bank) → Higher attack/defend for Fam Wars + higher hourly pay for every member. 
                Hourly payout = 60% to your Personal Bank + 40% Cash. Claim anytime (accrues up to 48h).
              </div>

              {/* Tab Menu for Members + Donations (visible to all in family, actions role-gated) */}
              <div className="mb-4">
                <div className="flex border-b border-zinc-800 mb-3">
                  <button
                    onClick={() => setActiveTab('members')}
                    className={`px-4 py-2 text-sm font-semibold ${activeTab === 'members' ? 'border-b-2 border-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Members
                  </button>
                  <button
                    onClick={() => setActiveTab('donations')}
                    className={`px-4 py-2 text-sm font-semibold ${activeTab === 'donations' ? 'border-b-2 border-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Pending Bank
                  </button>
                </div>

                {activeTab === 'members' && (
                  <div>
                    <div className="text-sm text-zinc-400 mb-2 flex items-center justify-between">
                      <span>Members ({myFamily.family.member_count})</span>
                      {canManageMembers && <span className="text-xs text-amber-400">Management enabled</span>}
                    </div>
                    <div className="bg-zinc-950 rounded-xl p-3 text-sm max-h-56 overflow-auto space-y-2">
                      {myFamily.members?.length ? (
                        myFamily.members.map((m, i) => {
                          const canManageThis = canManageMembers && m.role !== 'boss';
                          const isSelf = false; // TODO: compare with current user id if needed
                          const canKickThis = canKick && m.role !== 'boss' && !isSelf;

                          return (
                            <div key={i} className="flex items-center justify-between bg-zinc-900/60 px-3 py-2 rounded-lg">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{m.username || 'Unknown'}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 capitalize">{m.role}</span>
                              </div>

                              <div className="flex items-center gap-2">
                                {canManageThis && (
                                  <select
                                    value={m.role}
                                    onChange={(e) => {
                                      const newRole = e.target.value;
                                      if (newRole !== m.role) {
                                        const rank = (r: string) => ['boss','underboss','accountant','manager','caporegime','soldier','associate'].indexOf(r);
                                        const action = rank(newRole) < rank(m.role) ? 'promote' : 'demote';
                                        changeRole(m.player_id, newRole, action);
                                      }
                                    }}
                                    disabled={busy}
                                    className="bg-zinc-800 text-xs rounded px-2 py-1 border border-zinc-700"
                                  >
                                    {availableRolesForPromotion.map(r => <option key={r} value={r}>{r}</option>)}
                                  </select>
                                )}

                                {canKickThis && (
                                  <button
                                    onClick={() => kickMember(m.player_id, m.username)}
                                    disabled={busy}
                                    className="text-xs px-2 py-1 bg-red-900/60 hover:bg-red-800 rounded text-red-300"
                                  >
                                    Kick
                                  </button>
                                )}

                                {!canManageThis && !canKickThis && <span className="text-xs text-zinc-600">—</span>}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-zinc-500 py-2">No members data</div>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">Boss & Underboss have full member control (including kick). Managers limited.</p>
                  </div>
                )}

                {activeTab === 'donations' && (
                  <div>
                    <div className="mb-4 p-3 bg-zinc-950 rounded border border-zinc-700">
                      <div className="uppercase text-[10px] tracking-widest text-emerald-400 mb-1">PENDING BANK</div>
                      <div className="text-sm">All donations land here first. Leaders (Boss / Underboss / Accountant) review and move funds to main Bank or directly buy Family Power.</div>
                    </div>

                    <div className="mb-3">
                      <div className="text-sm text-zinc-400 mb-1">Donate to Pending Bank (weekly boss requests recommended)</div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={donationAmount}
                          onChange={(e) => setDonationAmount(Math.max(1, parseInt(e.target.value) || 1))}
                          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-sm w-28"
                          disabled={busy}
                        />
                        <button onClick={donate} disabled={busy} className="px-4 py-1 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold disabled:opacity-50">
                          Donate to Pending
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-1">Money stays in Pending until accepted by leadership. Then it can be used to buy Power (which boosts hourly pay for everyone + Fam Wars strength).</p>
                    </div>

                    {/* Pending Donations + Live Logs */}
                    <div className="mb-3">
                      <div className="text-sm font-semibold text-amber-400 mb-1">Pending Donations &amp; Logs (click names for profile)</div>
                      <div className="bg-zinc-950 rounded-xl p-3 text-sm max-h-48 overflow-auto space-y-1">
                        {myFamily.pending_donations && myFamily.pending_donations.length > 0 ? (
                          myFamily.pending_donations.map((d, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-zinc-900/60 px-3 py-1.5 rounded">
                              <div>
                                <Link 
                                  href={`/profile?user=${encodeURIComponent(d.username || '')}`} 
                                  className="font-medium text-red-400 hover:underline"
                                >
                                  {d.username || 'Unknown'}
                                </Link>{' '}
                                donated <span className="text-emerald-400">${d.amount}</span>
                                <span className="text-xs text-zinc-500 ml-2">{new Date(d.donated_at).toLocaleString()}</span>
                              </div>
                              {canAcceptDonations && (
                                <button onClick={() => acceptDonation(d.id)} disabled={busy} className="text-xs bg-emerald-800 hover:bg-emerald-700 px-2 py-0.5 rounded">
                                  Accept → Bank
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-zinc-500 py-1">No pending donations yet. Members should donate weekly.</div>
                        )}
                      </div>
                    </div>

                    <div className="text-[10px] text-zinc-400 bg-zinc-950 p-2 rounded">
                      Flow: <strong>Donate → Pending Bank</strong> → Leaders accept or directly buy Power → Power increases hourly payouts (auto from family bank) + attack/defend for wars.
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={leaveFamily}
                disabled={busy}
                className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm disabled:opacity-50"
              >
                Leave Family
              </button>

              {/* FAMILY BOSS / LEADER SUBMENU - "The Table" with own vibe */}
              {(isBoss || isUnderboss || isAccountant) && (
                <div className="mt-8 pt-6 border-t border-amber-900/40">
                  <div className="uppercase tracking-[3px] text-amber-400 text-xs mb-2">THE TABLE — LEADER ONLY</div>
                  <div className="text-sm mb-3">Full control over the family. Use wisely.</div>

                  <div className="grid md:grid-cols-3 gap-3">
                    {/* Treasury direct actions */}
                    <div className="bg-zinc-950 p-4 rounded-xl">
                      <div className="font-semibold mb-2">Treasury</div>
                      <button onClick={async () => {
                        if (!confirm('Buy 100 Power using family bank funds?')) return;
                        setBusy(true);
                        const { error } = await supabase.rpc('buy_family_power', { spend_amount: 200000 });
                        setBusy(false);
                        if (!error) { addLogLocal('Bought 100 Power for crew'); await loadData(); }
                        else setError('Need sufficient bank balance.');
                      }} className="w-full py-2 bg-emerald-800 rounded text-sm mb-2">Buy 100 Power (200k from bank)</button>
                      <button onClick={async () => {
                        if (!confirm('Buy 500 Power? Large spend.')) return;
                        setBusy(true);
                        const { error } = await supabase.rpc('buy_family_power', { spend_amount: 1000000 });
                        setBusy(false);
                        if (!error) await loadData();
                      }} className="w-full py-2 bg-emerald-700 rounded text-sm">Buy 500 Power (1M bank)</button>
                      <p className="text-[10px] text-zinc-500 mt-2">Power raises hourly payouts for the whole crew + war strength.</p>
                    </div>

                    {/* Crew Discipline */}
                    <div className="bg-zinc-950 p-4 rounded-xl">
                      <div className="font-semibold mb-2">Crew Discipline</div>
                      <p className="text-xs mb-2">Remove troublemakers or reward loyalty.</p>
                      <button onClick={() => alert('Use the member list above to promote/kick. Additional mass actions coming.')} className="w-full py-1.5 bg-red-900/70 text-sm rounded">Mass Kick Low-Activity (soon)</button>
                    </div>

                    {/* Family Settings & Ops */}
                    <div className="bg-zinc-950 p-4 rounded-xl">
                      <div className="font-semibold mb-2">Family Operations</div>
                      <button onClick={async () => {
                        const newTag = prompt('New 2-5 letter tag?');
                        if (!newTag || newTag.length < 2) return;
                        setBusy(true);
                        await supabase.from('families').update({ tag: newTag.toUpperCase() }).eq('id', myFamily!.family!.id);
                        setBusy(false);
                        await loadData();
                        addLogLocal('Family tag updated');
                      }} className="text-xs px-3 py-1 bg-zinc-800 rounded mb-1 mr-1">Change Tag</button>
                      <button onClick={() => alert('Family announcement broadcast (future)')} className="text-xs px-3 py-1 bg-zinc-800 rounded">Broadcast Message</button>
                      <div className="text-[10px] text-amber-300 mt-3">Only Boss &amp; Underboss see the full power here. Accountant handles treasury.</div>
                    </div>
                  </div>
                </div>
              )}
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

                  <div className="text-xs text-amber-400 mb-2">
                    Cost: 2,000,000 cash <span className="text-zinc-500">or</span> 25 diamonds (diamonds = much more attractive). Donators can create at any rank with 25 diamonds and start as boss alone.
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
          Families gain Respect and Territory through crimes, wars, and territory control (coming soon). Power fuels Fam Wars and hourly member payouts.
        </div>
      </div>
    </div>
  );
}

// =============================================
// Family Power + Hourly Pay UI Component
// Donating + Bosses buying power increases hourly + war strength
// Payouts: 60% personal_bank, 40% cash
// =============================================
function FamilyPowerHourlySection({ 
  myFamily, 
  onRefresh, 
  canManagePower 
}: { 
  myFamily: any; 
  onRefresh: () => Promise<void>; 
  canManagePower: boolean;
}) {
  const [powerStatus, setPowerStatus] = useState<any>(null);
  const [spendAmount, setSpendAmount] = useState(50000);
  const [busyPower, setBusyPower] = useState(false);
  const [busyClaim, setBusyClaim] = useState(false);
  const [msg, setMsg] = useState('');

  const supabase = createClient();

  const loadPower = async () => {
    try {
      const { data } = await supabase.rpc('get_family_power_status');
      if (data) setPowerStatus(data);
    } catch {}
  };

  useEffect(() => {
    loadPower();
  }, [myFamily?.family?.id]);

  const buyPower = async () => {
    if (!spendAmount || spendAmount < 25000) return;
    if (!confirm(`Confirm spend $${spendAmount} from family bank to buy power?`)) {
      return;
    }
    setBusyPower(true);
    setMsg('');
    const { data, error } = await supabase.rpc('buy_family_power', { spend_amount: spendAmount });
    setBusyPower(false);
    if (error) {
      setMsg(error.message.includes('NOT_AUTHORIZED') ? 'Only Boss/Underboss/Accountant can buy power.' : (error.message || 'Failed to buy power'));
    } else {
      setMsg(`+${data?.power_gained || '?'} Family Power purchased! Bank spent: $${spendAmount.toLocaleString()}`);
      await loadPower();
      await onRefresh();
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    }
  };

  const claimHourly = async () => {
    if (!confirm('Confirm claim hourly pay from family bank? 60% to personal bank, 40% to cash.')) {
      return;
    }
    setBusyClaim(true);
    setMsg('');
    const { data, error } = await supabase.rpc('claim_family_hourly');
    setBusyClaim(false);
    if (error) {
      setMsg('Failed to claim hourly pay. Are you in a family?');
    } else if (data?.success) {
      setMsg(`Claimed for ${data.hours}h: $${data.total_pay} total • $${data.bank_deposit} → Bank (60%) • $${data.cash_deposit} → Cash (40%). Power: ${data.family_power}`);
      await loadPower();
      await onRefresh();
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    } else {
      setMsg(data?.reason === 'NO_PAY_DUE' ? `No pay due yet (${data.hours || 0}h elapsed).` : 'Nothing to claim.');
    }
  };

  const hourly = powerStatus?.hourly_per_member ?? Math.max(1, Math.floor(((myFamily?.family?.power || 0) / 200) + ((myFamily?.family?.bank || 0) / 500000)));
  const currentPower = powerStatus?.power ?? (myFamily?.family?.power || 0);

  return (
    <div className="mb-5 border border-zinc-800 bg-zinc-950 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="uppercase text-[10px] tracking-widest text-amber-400 font-bold">FAMILY POWER &amp; HOURLY PAY</div>
          <div className="text-xl font-bold">Power: <span className="font-mono text-amber-300">{currentPower.toLocaleString()}</span></div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-400">Avg Hourly / Member</div>
          <div className="text-2xl font-mono text-emerald-400 tabular-nums">${hourly}</div>
        </div>
      </div>

      <div className="text-xs text-zinc-400 mb-3">
        Power increases <strong>Family attack/defense</strong> for future wars and directly raises the hourly payout pool. 
        Higher power = bigger numbers for everyone. Leaders convert bank into power.
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button 
          onClick={claimHourly} 
          disabled={busyClaim}
          className="px-4 py-2 text-sm rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 font-semibold"
        >
          {busyClaim ? 'Claiming...' : 'Claim Family Hourly Pay'}
        </button>
        <span className="text-[10px] self-center text-zinc-500">60% Bank • 40% Cash per hour accrued</span>
      </div>

      {canManagePower && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="text-xs uppercase tracking-widest text-red-400 mb-1">LEADER ACTIONS — BUY FAMILY POWER</div>
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              value={spendAmount} 
              onChange={e => setSpendAmount(Math.max(25000, parseInt(e.target.value) || 25000))}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 w-36 text-sm" 
            />
            <button 
              onClick={buyPower} 
              disabled={busyPower}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold disabled:opacity-50"
            >
              {busyPower ? 'Buying...' : 'Buy Power (spend bank)'}
            </button>
            <span className="text-xs text-zinc-500">~1 power per $2,000 spent (min $25k)</span>
          </div>
          <div className="text-[10px] text-amber-300 mt-1">Buying power is how you turn donations into real strength and better pay for the whole family.</div>
        </div>
      )}

      {msg && <div className="mt-2 text-xs text-emerald-400">{msg}</div>}
    </div>
  );
}
