'use client';

import { usePlayer } from '../components/PlayerContext';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function SafehousePage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const owned = player?.owned_properties || [];
  const safehouses = owned.filter((p: any) => p.name && (p.name.toLowerCase().includes('house') || p.name.toLowerCase().includes('villa') || p.name.toLowerCase().includes('mansion')));

  const getWelcome = (prop: any) => {
    const name = prop.name || 'your spot';
    if (prop.name.toLowerCase().includes('mansion')) {
      return `Welcome back, Kingpin! Time to stack that empire in ${name}. (Mansion vibes - let's hustle with style!)`;
    } else if (prop.name.toLowerCase().includes('villa')) {
      return `Back in the game, boss. ${name} is ready for the next move. Mid-tier motivation - keep pushing!`;
    } else {
      return `Welcome back, hustler. ${name} is your grind spot. Low life but we rise!`;
    }
  };

  const getShedCap = (prop: any) => {
    const lvl = prop.shed_level || 1;
    let base = 1000;
    if (lvl === 2) base = 2500;
    if (lvl === 3) base = 3500;
    if (prop.name.toLowerCase().includes('villa')) base = Math.floor(base * 1.5);
    if (prop.name.toLowerCase().includes('mansion')) base = Math.floor(base * 2.5);
    return base;
  };

  const upgradeShed = async (propId: string) => {
    if (!player) return;
    const owned = player.owned_properties || [];
    const prop = owned.find((p: any) => p.id === propId);
    if (!prop) return;
    const currentLvl = prop.shed_level || 1;
    if (currentLvl >= 3) {
      alert('Max shed level 3.');
      return;
    }
    const cost = 50000 * currentLvl;
    if (!confirm(`Confirm shed upgrade to lvl ${currentLvl + 1} for $${cost.toLocaleString()}?`)) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('upgrade_shed', { prop_id: propId });
    if (error) {
      alert(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash for upgrade.' : (error.message || 'Upgrade failed.'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    alert(`Shed upgraded to lvl ${data?.new_level}!`);
  };

  const simulateEarnings = async (propId: string) => {
    if (!player) return;
    const owned = player.owned_properties || [];
    const idx = owned.findIndex((p: any) => p.id === propId);
    if (idx === -1) return;
    const prop = { ...owned[idx] };
    const income = prop.income || 50;
    const taxRate = 0.20; // 20% realistic business tax
    const earned = Math.floor(income * 24); // 24h earnings
    const tax = Math.floor(earned * taxRate);
    const net = earned - tax;
    prop.bank_balance = (prop.bank_balance || 0) + net;
    prop.earnings_week = (prop.earnings_week || 0) + earned;
    prop.last_earned = new Date().toISOString();
    // Add tax to debt or bill
    prop.maintenance_due = (prop.maintenance_due || 0) + tax;
    const newOwned = [...owned];
    newOwned[idx] = prop;
    const supabase = createClient();
    const { error } = await supabase.rpc('update_my_state', { patch: { owned_properties: newOwned } });
    if (error) {
      alert(error.message || 'Failed to save earnings.');
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    alert(`Day earnings: +$${net} (after 20% tax $${tax}). Weekly earnings tracking updated.`);
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 Safehouse</h1>
      <p className="text-sm text-zinc-400 mb-6">Your properties for growing, storage, and cars. Details, costs, upgrades.</p>

      {safehouses.length === 0 && <p className="text-amber-400">Purchase a House, Villa or Mansion in Real Estate to unlock Safehouse features.</p>}

      {safehouses.map((prop: any, i: number) => {
        const cap = getShedCap(prop);
        const currentWeed = player?.drug_storage?.Weed || 0;
        const successKg = player?.successful_harvest_kg || 0;
        const failedKg = player?.failed_harvest_kg || 0;
        const isMansion = prop.name.toLowerCase().includes('mansion');
        const piggy = prop.piggy_bank || 0;
        return (
        <div key={i} className="card p-6 mb-6">
          <h2 className="text-2xl font-bold mb-2">{getWelcome(prop)}</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div>Purchase Date: {prop.purchase_date ? new Date(prop.purchase_date).toLocaleDateString() : 'N/A'}</div>
              <div>Maintenance: ~12% of income/hr</div>
              <div>Spots: {prop.spots || 2} (weed)</div>
              <div>Bank Balance: ${prop.bank_balance || 0}</div>
              <div>Current Debt: ${prop.maintenance_due || 0}</div>
              <div>Weekly Earnings (pre-tax): ${prop.earnings_week || 0}</div>
            </div>
            <div>
              <div>Upgrades: Warehouse (cars), Shed (storage)</div>
              <div>Autopay: {prop.autopay ? 'Enabled' : 'Disabled'}</div>
              {isMansion && <div>Piggybank (Hidden Safe): ${piggy} (Family sees full)</div>}
              <div className="mt-2 text-xs text-zinc-400">Full details and upgrades coming. Pay bills in Real Estate.</div>
            </div>
          </div>

          {prop.name.toLowerCase().includes('villa') && (
            <div className="mt-4 p-4 bg-zinc-800 rounded">
              <h4 className="font-bold">🛡️ Villa Bodyguard Team (Raid Protection)</h4>
              <div>Current Bodyguards: {prop.bodyguards || 0}/10</div>
              <div>Base Raid Chance: 30% | -4% per guard</div>
              <button onClick={async () => {
                if (!player) return;
                const current = prop.bodyguards || 0;
                if (current >= 10) { alert('Max 10.'); return; }
                const supabase = createClient();
                const { data, error } = await supabase.rpc('hire_bodyguard', { prop_id: prop.id });
                if (error) {
                  alert(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash.' : (error.message || 'Hire failed.'));
                  return;
                }
                if (refreshPlayer) await refreshPlayer();
                router.refresh();
                alert(`Hired bodyguard #${data?.bodyguards} for $${data?.cost}. Raid chance now ${30 - (data?.bodyguards || 1)*4}%.`);
              }} className="mt-2 px-3 py-1 bg-blue-700 rounded text-sm">Hire Bodyguard ($2000, discount after 5)</button>
              <p className="text-[10px] text-zinc-500">Need 2+ to be effective. Max 10. Alternative: buy house weapon for protection.</p>
            </div>
          )}

          {isMansion && (
            <div className="mt-4 p-4 bg-zinc-800 rounded">
              <h4 className="font-bold">🐷 Mansion Piggybank (Standalone Hidden Bank)</h4>
              <div className="flex gap-2 mt-2">
                <input type="number" id={`piggy-deposit-${i}`} placeholder="Amount" className="bg-zinc-900 border px-2 py-1 w-24" />
                <button onClick={async () => {
                  if (!player) return;
                  const amt = parseInt((document.getElementById(`piggy-deposit-${i}`) as HTMLInputElement)?.value || '0');
                  if (amt <= 0 || (player?.cash || 0) < amt) {
                    alert('Invalid amount or not enough cash!');
                    return;
                  }
                  if (!confirm(`Confirm deposit of $${amt} to Piggybank? This will be hidden from global leaderboard.`)) {
                    return;
                  }
                  const supabase = createClient();
                  const { error } = await supabase.rpc('piggy_deposit', { prop_id: prop.id, amount: amt });
                  if (error) {
                    alert(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : (error.message || 'Deposit failed.'));
                    return;
                  }
                  if (refreshPlayer) await refreshPlayer();
                  router.refresh();
                  alert(`Deposited $${amt} to Piggybank (hidden from global total). Transferred successfully.`);
                }} className="px-3 py-1 bg-emerald-700 rounded text-sm">Deposit</button>
              </div>
              <div className="flex gap-2 mt-2">
                <input type="number" id={`piggy-withdraw-${i}`} placeholder="Amount" className="bg-zinc-900 border px-2 py-1 w-24" />
                <button onClick={async () => {
                  if (!player) return;
                  const amt = parseInt((document.getElementById(`piggy-withdraw-${i}`) as HTMLInputElement)?.value || '0');
                  if (amt <= 0 || (prop.piggy_bank || 0) < amt) {
                    alert('Invalid amount or not enough in Piggybank!');
                    return;
                  }
                  const fee = Math.floor(amt * 0.008);
                  const net = amt - fee;
                  if (!confirm(`Confirm withdraw of $${amt} from Piggybank to Cash? (0.8% fee $${fee} to Gov Tax, you get $${net})`)) {
                    return;
                  }
                  const supabase = createClient();
                  const { error } = await supabase.rpc('piggy_withdraw', { prop_id: prop.id, amount: amt });
                  if (error) {
                    alert(error.message.includes('NOT_ENOUGH_IN_PIGGYBANK') ? 'Not enough in Piggybank!' : (error.message || 'Withdraw failed.'));
                    return;
                  }
                  if (refreshPlayer) await refreshPlayer();
                  router.refresh();
                  alert(`Withdrew $${net} from Piggybank (fee $${fee} to Gov Tax). Transferred successfully.`);
                }} className="px-3 py-1 bg-red-700 rounded text-sm">Withdraw to Cash</button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Piggybank is hidden from general leaderboard. Family leaderboard sees full player wealth.</p>
            </div>
          )}

          {/* Shed Submenu - Weed Live Trackers */}
          <div className="mt-4 p-4 bg-zinc-950 rounded border border-zinc-700">
            <h4 className="font-bold mb-2">Shed (Weed Storage & Grow)</h4>
            <div>Capacity: {currentWeed} / {cap} Kgs</div>
            <div>Successful Harvest Total: {successKg} Kg's</div>
            <div>Failed Harvest Total: {failedKg} Kg's</div>
            <div className="mt-2 text-xs">Live trackers: Progress, quality % (see Weed Grow for details). Cooldowns sync globally.</div>
            <button onClick={() => upgradeShed(prop.id)} className="mt-2 px-3 py-1 bg-red-700 rounded text-sm">Upgrade Shed (${50000 * (prop.shed_level || 1)})</button>
            <button onClick={() => simulateEarnings(prop.id)} className="mt-2 ml-2 px-3 py-1 bg-emerald-700 rounded text-sm">Simulate 24h Earnings (20% tax applied live)</button>
          </div>

          <div className="mt-4">
            <Link href="/weed-grow" className="text-red-400 text-sm">Shed → Full Weed Grow & Trackers</Link> | <Link href="/garage" className="text-red-400 text-sm">Garage → Cars</Link>
          </div>
        </div>
        );
      })}

      <div className="mt-8">
        <h3 className="font-bold mb-2">Shed (Storage & Grow)</h3>
        <p className="text-sm">Weed storage and grow progress. Move to dedicated Weed Grow.</p>
        <Link href="/weed-grow" className="text-red-400">Go to Weed Grow →</Link>
      </div>

      <div className="mt-4">
        <h3 className="font-bold mb-2">Garage</h3>
        <p className="text-sm">Cars, tuning, racing. Full garage features.</p>
        <Link href="/garage" className="text-red-400">Open Garage →</Link>
      </div>

      {/* Personalized Submenus - Profile Settings like Bulletstar */}
      <div className="mt-8 card p-5">
        <h3 className="font-bold mb-2">👤 Profile Settings (Safehouse Personal)</h3>
        <p className="text-xs text-zinc-400 mb-3">Customize avatar, bio, details. (Bulletstar style profile)</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label>Avatar URL</label>
            <input id="profile-avatar" type="text" placeholder="https://picsum... " className="w-full bg-zinc-900 border px-2 py-1" defaultValue={player?.avatar_url || 'https://picsum.photos/id/1005/100/100'} />
          </div>
          <div>
            <label>Bio / Description</label>
            <textarea id="profile-bio" className="w-full bg-zinc-900 border px-2 py-1" rows={2} defaultValue={player?.bio || 'The streets made me...'} />
          </div>
          <div>
            <label>Favorite Crime</label>
            <input type="text" className="w-full bg-zinc-900 border px-2 py-1" defaultValue="Pickpocket" />
          </div>
          <div>
            <label>Status Message</label>
            <input type="text" className="w-full bg-zinc-900 border px-2 py-1" defaultValue="Building the empire" />
          </div>
        </div>
        <button onClick={async () => {
          if (!player) return;
          const avatar = (document.getElementById('profile-avatar') as HTMLInputElement)?.value || '';
          const bio = (document.getElementById('profile-bio') as HTMLTextAreaElement)?.value || '';
          const supabase = createClient();
          const { error } = await supabase.rpc('update_my_state', { patch: { avatar_url: avatar, bio } });
          if (error) {
            alert(error.message || 'Failed to save profile.');
            return;
          }
          if (refreshPlayer) await refreshPlayer();
          router.refresh();
          alert('Profile saved!');
        }} className="mt-3 px-4 py-1 bg-red-700 rounded text-sm">Save Profile</button>
      </div>

      {/* Post Office - Bills, Debts, Taxes, Property Info */}
      <div className="mt-8 card p-5">
        <h3 className="font-bold mb-2">📮 Post Office (Bills & Taxes)</h3>
        <p className="text-xs text-zinc-400 mb-3">Pay open bills, debts, unpaid taxes. Live trackers. Property tax rates and info.</p>
        <div className="text-sm">
          <div>Open Bills: ${(player?.owned_properties || []).reduce((sum: number, p: any) => sum + (p.maintenance_due || 0), 0).toLocaleString()} (from properties)</div>
          <div>Weekly Tax Bill: ${Math.floor((player?.owned_properties || []).reduce((sum: number, p: any) => sum + (p.earnings_week || 0), 0) * 0.20).toLocaleString()} (20% on earnings)</div>
          <div>Property Tax Rate: 10% on purchase, 20% on earnings (to Gov Fund)</div>
          <button onClick={async () => {
            if (!player) return;
            const props = (player.owned_properties || []).filter((p: any) => (p.maintenance_due || 0) > 0);
            const total = props.reduce((sum: number, p: any) => sum + (p.maintenance_due || 0), 0);
            if (total <= 0) { alert('No open bills. All clear!'); return; }
            if (!confirm(`Confirm pay all open property bills: $${total.toLocaleString()} (cash)?`)) return;
            const supabase = createClient();
            for (const p of props) {
              const { error } = await supabase.rpc('pay_property_bill', { prop_id: p.id, amount: p.maintenance_due, method: 'cash' });
              if (error) {
                alert(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash for all bills!' : (error.message || 'Payment failed.'));
                break;
              }
            }
            if (refreshPlayer) await refreshPlayer();
            router.refresh();
            alert(`Bills paid to Gov Fund.`);
          }} className="mt-2 px-3 py-1 bg-emerald-700 rounded text-sm">Pay All Open Bills</button>
        </div>
        <div className="mt-2 text-xs">All tax to Government Fund. Admin sees summary.</div>
      </div>

      <Link href="/dashboard" className="mt-8 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
