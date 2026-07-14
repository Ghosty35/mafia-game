'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';

interface Property {
  id: string;
  name: string;
  type: string;
  city: string;
  price: number;
  income: number;
  spots: number;
  risk?: string;
  image: string;
}

export default function RealEstatePage() {
  const { player, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [billAmount, setBillAmount] = useState(0);
  const [autopay, setAutopay] = useState(false);

  if (!player) return <div className="p-6">Loading player data...</div>;

  const currentCity = player.current_city || 'New York';

  // Properties are city-specific. You only see (and can buy) properties in the city you are currently in.
  // Travel to other cities to view and purchase their real estate.
  const allProperties: Property[] = [
    // New York
    { id: 'ts1', type: 'agency', name: 'Train Station', city: 'New York', price: 25000, income: 100, spots: 0, image: 'https://picsum.photos/id/1015/300/150', risk: 'Low' },
    { id: 'house1', type: 'residential', name: 'House (Weed/Safehouse)', city: 'New York', price: 15000, income: 40, spots: 2, image: 'https://picsum.photos/id/29/300/150', risk: '65% Police Raid - High risk for small timers!' },
    // Chicago
    { id: 'mf1', type: 'agency', name: 'Metal Factory', city: 'Chicago', price: 45000, income: 240, spots: 0, image: 'https://picsum.photos/id/160/300/150', risk: 'Medium' },
    { id: 'villa1', type: 'residential', name: 'Villa (Weed/Safehouse)', city: 'Chicago', price: 75000, income: 120, spots: 4, image: 'https://picsum.photos/id/160/300/150', risk: '30% Police Raid - Upgrade to Warehouse for cars!' },
    // Los Angeles
    { id: 'da1', type: 'agency', name: 'Detective Agency', city: 'Los Angeles', price: 30000, income: 160, spots: 0, image: 'https://picsum.photos/id/201/300/150', risk: 'Low' },
    { id: 'house_la', type: 'residential', name: 'House (Weed/Safehouse)', city: 'Los Angeles', price: 16000, income: 42, spots: 2, image: 'https://picsum.photos/id/29/300/150', risk: '62% Police Raid' },
    // Miami
    { id: 'h1', type: 'agency', name: 'Hospital', city: 'Miami', price: 35000, income: 180, spots: 0, image: 'https://picsum.photos/id/251/300/150', risk: 'Medium' },
    { id: 'villa_mi', type: 'residential', name: 'Villa (Weed/Safehouse)', city: 'Miami', price: 78000, income: 125, spots: 4, image: 'https://picsum.photos/id/160/300/150', risk: '28% Police Raid' },
    // Las Vegas
    { id: 'gb1', type: 'agency', name: 'General Bank', city: 'Las Vegas', price: 80000, income: 400, spots: 0, image: 'https://picsum.photos/id/180/300/150', risk: 'High' },
    { id: 'mansion1', type: 'residential', name: 'Mansion (Weed/Safehouse)', city: 'Las Vegas', price: 1500000, income: 300, spots: 8, image: 'https://picsum.photos/id/251/300/150', risk: '0% - Ultimate safehouse, no raids!' },
    // Extra residential options per city for variety
    { id: 'house_chi', type: 'residential', name: 'House (Weed/Safehouse)', city: 'Chicago', price: 15500, income: 41, spots: 2, image: 'https://picsum.photos/id/29/300/150', risk: '64% Police Raid' },
    { id: 'mansion_la', type: 'residential', name: 'Mansion (Weed/Safehouse)', city: 'Los Angeles', price: 1550000, income: 295, spots: 8, image: 'https://picsum.photos/id/251/300/150', risk: '0% - No raids ever!' },
    { id: 'house_mi', type: 'residential', name: 'House (Weed/Safehouse)', city: 'Miami', price: 15200, income: 39, spots: 2, image: 'https://picsum.photos/id/29/300/150', risk: '63% Police Raid' },
    { id: 'villa_lv', type: 'residential', name: 'Villa (Weed/Safehouse)', city: 'Las Vegas', price: 82000, income: 130, spots: 4, image: 'https://picsum.photos/id/160/300/150', risk: '25% Police Raid' },
  ];

  // IMPORTANT: Only show properties of the CURRENT city. Travel to see others.
  const cityProperties = allProperties.filter(p => p.city === currentCity);
  const buyableProperties = cityProperties.filter(p => p.type === 'residential');
  const agencyProperties = cityProperties.filter(p => p.type === 'agency');

  const buyProperty = async (prop: Property) => {
    if (!player || player.cash < prop.price) {
      setMessage('Not enough cash!');
      return;
    }

    const owned = player.owned_properties || [];
    const mansions = owned.filter((o: any) => o.name.toLowerCase().includes('mansion')).length;
    const villas = owned.filter((o: any) => o.name.toLowerCase().includes('villa')).length;
    const houses = owned.filter((o: any) => o.name.toLowerCase().includes('house')).length;

    const isMansion = prop.name.toLowerCase().includes('mansion');
    const isVilla = prop.name.toLowerCase().includes('villa');
    const isHouse = prop.name.toLowerCase().includes('house');

    if (isMansion && mansions >= 1) {
      setMessage('Max 1 Mansion per player (to avoid overpowering weed yields).');
      return;
    }
    if (isVilla && villas >= 2) {
      setMessage('Max 2 Villas (must be in different cities).');
      return;
    }
    if (isVilla && villas > 0 && owned.some((o: any) => o.name.toLowerCase().includes('villa') && o.city === prop.city)) {
      setMessage('Villas must be in different cities.');
      return;
    }
    if (isHouse) {
      const housesInCity = owned.filter((o: any) => o.name.toLowerCase().includes('house') && o.city === prop.city).length;
      if (housesInCity >= 1) {
        setMessage('You already own a house in this city. Houses must be in separate cities (max 4 total in 4 different cities).');
        return;
      }
      if (houses >= 4) {
        setMessage('Max 4 Houses total (one per city).');
        return;
      }
    }
    if (owned.length >= 4) {
      setMessage('Total property limit reached (4).');
      return;
    }

    // Warning for multiple properties - generated message
    const houseCount = isHouse ? houses + 1 : houses;
    if (houseCount > 1) {
      const warnings = [
        "Buying another house means more grinding! Bills will stack up like crazy - your wallet's gonna cry, but hey, more weed spots!",
        "Second (or third) property? Brace yourself for the bill avalanche. Serious cash drain incoming, but the empire grows... with funny tax jokes from the IRS.",
        "Another house? Time for more hustle! The weekly bills are coming in hot - prepare for 'funny' reminders that you're now a multi-property mogul with multi-bill pain."
      ];
      setMessage(warnings[Math.floor(Math.random() * warnings.length)]);
    }

    setBusy(true);

    // Prompt for custom name
    const customName = prompt('Name your property (e.g. "Ghost\'s Palace"):', prop.name) || prop.name;

    // Tax on purchase (calibrated 10% for properties)
    const tax = Math.floor(prop.price * 0.10);
    const totalCost = prop.price + tax;

    if (player.cash < totalCost) {
      setMessage('Not enough cash including 10% property tax!');
      setBusy(false);
      return;
    }

    // Server-side purchase: deducts cash + tax atomically and appends the property
    const newProp = {
      id: prop.id,
      name: customName,
      type: prop.type,
      city: prop.city,
      purchase_date: new Date().toISOString(),
      bank_balance: 0,
      maintenance_due: Math.floor(prop.income * 0.12),
      autopay: false,
      shed_level: 1,
      earnings_week: 0,
      last_earned: new Date().toISOString()
    };

    const supabase = createClient();
    const { error } = await supabase.rpc('purchase_property', { prop: newProp, price: prop.price });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage('Not enough cash including 10% property tax!');
      else if (error.message.includes('PROPERTY_LIMIT_REACHED')) setMessage('Total property limit reached (4).');
      else setMessage(error.message || 'Purchase failed.');
      setBusy(false);
      return;
    }

    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(`Bought ${customName} in ${prop.city} for $${prop.price} (+$${tax} 10% tax to Gov Fund)!`);
    setBusy(false);
  };

  // Advanced Billing
  const payBill = async (propId: string, amount: number, method: 'cash' | 'bank') => {
    if (!player) return;

    const owned = player.owned_properties || [];
    const prop = owned.find(p => p.id === propId);
    if (!prop) return;

    const totalDebt = prop.maintenance_due || 850;
    const pay = Math.min(amount, totalDebt);

    if (!confirm(`Confirm pay $${pay} via ${method} for this property?${method === 'bank' ? ' (5% extra tax from bank)' : ''}`)) {
      return;
    }

    // Server-side payment: validates funds and updates debt atomically
    const supabase = createClient();
    const { error } = await supabase.rpc('pay_property_bill', { prop_id: propId, amount: pay, method });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage('Not enough cash!');
      else if (error.message.includes('NOT_ENOUGH_IN_BANK')) setMessage('Not enough in bank (5% extra tax)!');
      else setMessage(error.message || 'Payment failed.');
      return;
    }

    const newDebt = totalDebt - pay;
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(`Paid $${pay} via ${method}. Remaining debt: $${newDebt}. ${newDebt > 0 ? 'Pay more or set autopay!' : 'All clear!'}`);
  };

  const setAutopayForProp = async (propId: string, enable: boolean) => {
    if (!player) return;
    if (!confirm(`Confirm ${enable ? 'enable' : 'disable'} autopay for this property?`)) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc('set_property_autopay', { prop_id: propId, enable });
    if (error) {
      setMessage(error.message || 'Failed to update autopay.');
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(enable ? 'Autopay enabled! Will deduct weekly before Sunday.' : 'Autopay disabled.');
  };

  // Calculate maintenance suitable prices (avg ~12-15% of income, adjusted for risk)
  const getMaintenance = (prop: any) => {
    let base = Math.floor(prop.income * 0.12);
    if (prop.risk && prop.risk.includes('40%')) base = Math.floor(base * 1.2); // villa risk
    return base;
  };

  const getAvgProfit = (prop: any) => prop.income - getMaintenance(prop);

  const owned = player.owned_properties || [];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 Real Estate</h1>
      <p className="text-sm text-zinc-400 mb-2">Own the city. Grow your empire (and weed). Pay your bills on time or lose it all.</p>

      {/* City notice - key rule per user spec */}
      <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-red-900/40 text-sm">
        <span className="font-semibold text-red-400">Current City:</span> <span className="font-bold">{currentCity}</span>
        <span className="mx-2 text-zinc-500">•</span>
        You only see properties available in <span className="font-medium">{currentCity}</span>. 
        Travel to another city to view and buy properties there.
        <Link href="/travel" className="ml-2 text-red-400 underline">Travel now →</Link>
      </div>

      <p className="text-xs text-zinc-500 mb-6">Dev released agencies appear on the Marketplace for bidding. Residential properties (House / Villa / Mansion) are direct purchase for weed &amp; safehouse use.</p>

      {/* Buyable Residential Only - filtered to current city */}
      <h2 className="text-xl font-semibold mb-3">Buyable Properties in {currentCity} (Weed Production &amp; Safehouses)</h2>
      {buyableProperties.length === 0 && (
        <p className="text-sm text-amber-400 mb-4">No residential properties listed for {currentCity} right now. Travel to discover more.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {buyableProperties.map((prop, i) => {
          const maint = getMaintenance(prop);
          const profit = getAvgProfit(prop);
          return (
            <div key={i} className="card p-5">
              <img src={prop.image} alt={prop.name} className="w-full h-32 object-cover rounded mb-3" />
              <h3 className="font-bold text-lg">{prop.name} - {prop.city}</h3>
              <div className="text-xs mb-2">Spots for {prop.spots} weed plants. {prop.risk ? `Risk: ${prop.risk}` : 'No risk (Mansion)'}</div>
              
              <div className="my-2 text-sm">
                <div>Purchase: <span className="font-mono">${prop.price.toLocaleString()}</span></div>
                <div>Avg Income: <span className="font-mono text-emerald-400">+${prop.income}/hr</span></div>
                <div>Avg Maintenance: <span className="font-mono text-red-400">-${maint}/hr</span></div>
                <div>Avg Profit: <span className="font-mono text-emerald-400">+${profit}/hr</span></div>
                <div className="italic text-amber-400 text-xs mt-1">"Grow your green empire here - or watch it burn."</div>
              </div>

              <button onClick={() => buyProperty(prop)} disabled={busy} className="w-full mt-2 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold">
                Buy {prop.name} (for Weed)
              </button>
            </div>
          );
        })}
      </div>

      {/* Agency Properties - Info only, funny text, no buy (current city only) */}
      <h2 className="text-xl font-semibold mb-3">Agency Properties in {currentCity} (Dev Released on Marketplace)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {agencyProperties.map((prop, i) => {
          const maint = getMaintenance(prop);
          const profit = getAvgProfit(prop);
          return (
            <div key={i} className="card p-5 border border-amber-900">
              <img src={prop.image} alt={prop.name} className="w-full h-32 object-cover rounded mb-3" />
              <h3 className="font-bold text-lg">{prop.name} - {prop.city}</h3>
              <div className="text-xs mb-2">Income from player activity. {prop.risk ? `Risk: ${prop.risk}` : ''}</div>
              <div className="my-2 text-sm">
                <div>Avg Income: <span className="font-mono text-emerald-400">+${prop.income}/hr</span></div>
                <div>Avg Maintenance: <span className="font-mono text-red-400">-${maint}/hr</span></div>
                <div>Avg Profit: <span className="font-mono text-emerald-400">+${profit}/hr</span></div>
                <div className="italic text-amber-400 text-xs mt-1">"Steady cash from the streets - but watch the heat!"</div>
              </div>
              <div className="text-xs text-zinc-500">Bid on Marketplace. No direct purchase.</div>
            </div>
          );
        })}
      </div>

      {/* Advanced Professional Billing Menu */}
      <h2 className="text-xl font-semibold mb-3">💳 Billing Center (Online Banking Style)</h2>
      <div className="card p-6 mb-6">
        <div className="mb-4 flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} />
            Autopay Bills Weekly (before Sunday evenings - extra tax + late fees if skipped)
          </label>
        </div>

        {owned.length === 0 && <p className="text-zinc-500">No properties owned yet. Buy a House/Villa/Mansion above for weed production.</p>}

        {owned.map((prop: any, idx: number) => {
          const debt = prop.maintenance_due || 850;
          const purchaseDate = prop.purchase_date ? new Date(prop.purchase_date).toLocaleDateString() : 'N/A';
          const ownedDays = prop.purchase_date ? Math.floor((Date.now() - new Date(prop.purchase_date).getTime()) / (1000*3600*24)) : 0;
          const maintCost = Math.floor((prop.income || 50) * 0.12); // suitable ~12%
          const avgProfit = (prop.income || 50) - maintCost;

          return (
            <div key={idx} className="mb-6 border border-zinc-700 rounded p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-bold text-lg">Property: {prop.name}</div>
                  <div className="text-xs text-zinc-400">Purchased on: {purchaseDate} • Owned for {ownedDays} days</div>
                  <div className="text-xs">City: {prop.city} • Type: {prop.type} • Spots: {prop.spots || 'N/A'} (for weed)</div>
                </div>
                <div className="text-right text-sm">
                  <div>Current Debt: <span className="font-mono text-red-400">${debt}</span></div>
                  <div>Avg Maint: <span className="font-mono">-${maintCost}/hr</span></div>
                  <div>Avg Profit: <span className="font-mono text-emerald-400">+${avgProfit}/hr</span></div>
                </div>
              </div>

              <div className="text-xs mb-3">Property Bank Balance: ${prop.bank_balance || 0} (use for payments)</div>

              <div className="mb-3">
                <label className="block text-sm mb-1">Pay Amount</label>
                <div className="flex gap-2">
                  <input 
                    type="number" 
                    value={billAmount} 
                    onChange={e => setBillAmount(parseInt(e.target.value) || 0)} 
                    className="bg-zinc-900 border border-zinc-700 px-3 py-1 rounded w-32" 
                    placeholder="Amount" 
                  />
                  <button onClick={() => payBill(prop.id, billAmount, 'cash')} className="px-4 py-1 bg-emerald-700 rounded text-sm">Pay from Cash</button>
                  <button onClick={() => payBill(prop.id, billAmount, 'bank')} className="px-4 py-1 bg-emerald-700 rounded text-sm">Pay from Bank (+5% tax)</button>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => payBill(prop.id, debt, 'cash')} className="px-4 py-1 bg-emerald-700 rounded text-sm">Full Pay (Cash)</button>
                <button onClick={() => payBill(prop.id, Math.floor(debt / 2), 'bank')} className="px-4 py-1 bg-emerald-700 rounded text-sm">Start Payment Plan (50% now)</button>
                <button onClick={() => setAutopayForProp(prop.id, !prop.autopay)} className="px-4 py-1 bg-blue-700 rounded text-sm">{prop.autopay ? 'Disable' : 'Enable'} Autopay</button>
              </div>
            </div>
          );
        })}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}

