'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../components/PlayerContext';

export default function ShopPage() {
  const { t } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isDonator = !!player?.is_donator;

  // Donator discount: 25% off normal shop prices
  const getDiscountedPrice = (base: number) => isDonator ? Math.floor(base * 0.75) : base;
  const discountLabel = isDonator ? ' (-25% Donator)' : '';

  const buyProtection = async (points: number, cost: number) => {
    const finalCost = getDiscountedPrice(cost);
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc('buy_protection', { 
      protection_points: points, 
      cost: finalCost 
    });
    if (error) {
      setMessage(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : 'Purchase failed.');
    } else {
      setMessage(`Bought protection! +${points} protection equipped.${isDonator ? ' (Donator discount applied)' : ''}`);
    }
    setBusy(false);
  };

  const purchaseDonatorStatus = async (costDiamonds: number) => {
    if (!player || (player.diamonds || 0) < costDiamonds) {
      setMessage('Not enough diamonds for Donator Status.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    // Atomic server-side purchase: checks + deducts diamonds + grants donator
    const { error } = await supabase.rpc('purchase_donator', { cost_diamonds: costDiamonds });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_DIAMONDS')) setMessage('Not enough diamonds for Donator Status.');
      else if (error.message.includes('ALREADY_DONATOR')) setMessage('You are already a Donator!');
      else setMessage('Failed to activate Donator status.');
    } else {
      await refreshPlayer();
      setMessage('🎉 Welcome to Donator Status! All global XP +25%, earnings +20%, and shop items are now 25% cheaper. Donator tag unlocked.');
    }
    setBusy(false);
  };

  const shopItems = [
    { icon: '⏱️', title: 'Cooldown Reducer', desc: 'Reduce all cooldowns by 15%', price: '250 💎', soon: true },
    { icon: '💰', title: 'Cash Booster', desc: '+25% cash from crimes for 24h', price: '180 💎', soon: true },
    { icon: '🛡️', title: 'Jail Protection', desc: 'One-time get out of jail free', price: '120 💎', soon: true },
    { icon: '⭐', title: 'XP Multiplier', desc: '+30% XP for the next 10 crimes', price: '150 💎', soon: true },
    { icon: '👑', title: 'VIP Badge', desc: 'Show off your status on leaderboards', price: '500 💎', soon: true },
    { icon: '🔫', title: 'Better Tools', desc: 'Unlock higher tier crimes earlier', price: '320 💎', soon: true },
  ];

  // Coming Soon section for future heist gear etc. (Fase 5.1)
  const comingSoonGear = [
    { icon: '🔫', title: 'Street Pistol', desc: 'Basic +8% heist success', price: '450 💎' },
    { icon: '🛡️', title: 'Kevlar Vest', desc: 'Reduces jail time on fail by 30%', price: '380 💎' },
    { icon: '💣', title: 'C4 Kit', desc: 'Big boost for bank heists', price: '720 💎' },
  ];

  return (
    <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-1">🛒 {t('nav_shop')}</h1>
        <p className="text-sm text-zinc-500">Spend your diamonds on powerful boosts and cosmetics.</p>
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">💎 Boosts &amp; Perks <span className="text-[10px] px-2 py-0.5 bg-zinc-800 rounded text-zinc-500">COMING SOON</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shopItems.map((item, index) => (
            <div 
              key={index}
              className="card p-5 flex flex-col opacity-75"
            >
              <div className="text-3xl mb-3">{item.icon}</div>
              <h3 className="font-bold text-lg mb-1">{item.title}</h3>
              <p className="text-sm text-zinc-400 flex-1 mb-4">{item.desc}</p>
              
              <div className="flex items-center justify-between mt-auto">
                <span className="font-mono text-sm text-yellow-400">{item.price}</span>
                <button 
                  disabled 
                  className="px-4 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-500 cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Protection / Weapon Shop (now functional) */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">🛡️ Protection &amp; Bodyguards</h2>
        <p className="text-xs text-zinc-500 mb-3">Reduces health loss on crimes and heists.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <button 
            onClick={() => buyProtection(5, 450)} 
            className="card p-5 text-left hover:border-red-700 transition disabled:opacity-50"
            disabled={busy}
          >
            <div className="text-3xl mb-2">🛡️</div>
            <h3 className="font-bold">Body Armor</h3>
            <p className="text-sm text-zinc-400">+5 Protection • Reduces health damage</p>
            <div className="mt-3 text-emerald-400 font-mono">
              ${getDiscountedPrice(450)}{discountLabel}
            </div>
          </button>

          <button 
            onClick={() => buyProtection(8, 780)} 
            className="card p-5 text-left hover:border-red-700 transition disabled:opacity-50"
            disabled={busy}
          >
            <div className="text-3xl mb-2">🐕</div>
            <h3 className="font-bold">Pitbull</h3>
            <p className="text-sm text-zinc-400">+8 Protection • Loyal guard dog</p>
            <div className="mt-3 text-emerald-400 font-mono">
              ${getDiscountedPrice(780)}{discountLabel}
            </div>
          </button>

          <button 
            onClick={() => buyProtection(12, 1350)} 
            className="card p-5 text-left hover:border-red-700 transition disabled:opacity-50"
            disabled={busy}
          >
            <div className="text-3xl mb-2">💼</div>
            <h3 className="font-bold">Bodyguard</h3>
            <p className="text-sm text-zinc-400">+12 Protection • Professional protection</p>
            <div className="mt-3 text-emerald-400 font-mono">
              ${getDiscountedPrice(1350)}{discountLabel}
            </div>
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-6 p-3 rounded bg-zinc-900 border border-zinc-700 text-sm">
          {message}
        </div>
      )}

      {/* VIP FAMILY BUFFS — LOCKED TO DONATORS FOR FULL EXCLUSIVE VALUE */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">👑 VIP Family Buffs <span className="text-[10px] px-2 py-px bg-amber-900/40 text-amber-400 rounded">FAMILY ONLY</span></h2>
        <p className="text-xs text-zinc-500 mb-3">These improve the entire Family. <strong>Full bundles and premium pricing only available to Donators.</strong></p>

        <FamilyBuffsShop busy={busy} setMessage={setMessage} isDonator={isDonator} />
      </div>

      <div className="mt-12 text-center">
        <p className="text-zinc-500 text-sm">
          Diamonds are earned through rebirths and special events.
        </p>
        <Link 
          href="/dashboard" 
          className="inline-block mt-4 text-red-500 hover:text-red-400 text-sm font-semibold"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* VIP DONATOR SUBMENU — STRICTLY UNLOCKED ONLY FOR DONATOR STATUS PLAYERS */}
      {isDonator && (
      <div className="mt-10 border-t border-zinc-800 pt-8">
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          👑 VIP Donator Exclusive Shop
          <span className="text-xs px-3 py-0.5 bg-amber-500 text-black rounded-full font-bold">DONATOR ONLY</span>
        </h2>

        {!isDonator ? (
          <div className="card p-6 bg-gradient-to-br from-yellow-950/60 to-zinc-900 border border-yellow-700">
            <p className="mb-4 text-sm">Unlock permanent Donator status with a one-time purchase. This is your ticket to the VIP life.</p>
            
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-zinc-950 rounded">
                <div className="font-semibold mb-1">Donator Status</div>
                <div className="text-sm text-zinc-400">One-time activation • Permanent tag + global perks</div>
                <div className="mt-3 text-emerald-400 font-mono text-lg">500 💎</div>
              </div>
              <div>
                <button 
                  onClick={() => purchaseDonatorStatus(500)}
                  disabled={busy}
                  className="w-full py-3 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 rounded-xl font-bold text-lg disabled:opacity-50"
                >
                  {busy ? 'Activating...' : 'Become Donator (500 Diamonds)'}
                </button>
                <p className="text-[10px] text-center text-zinc-500 mt-1">After purchase you receive the Donator tag permanently.</p>
              </div>
            </div>

            <div className="text-xs text-amber-300">Perks stay on top of any double XP events.</div>
          </div>
        ) : (
          <div>
            <div className="text-emerald-400 text-sm mb-4">Thank you for supporting the game! Your Donator perks are active everywhere.</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="card p-4 border border-amber-600">
                <div className="font-bold">📈 Global XP Boost</div>
                <div className="text-sm text-zinc-300 mt-1">+25% XP from all crimes, heists and activities (stacks on events)</div>
              </div>
              <div className="card p-4 border border-amber-600">
                <div className="font-bold">💵 Increased Earnings</div>
                <div className="text-sm text-zinc-300 mt-1">+20% cash / reward from crimes and heists</div>
              </div>
              <div className="card p-4 border border-amber-600">
                <div className="font-bold">🛒 Shop Discount</div>
                <div className="text-sm text-zinc-300 mt-1">-25% on all normal shop items (prices shown with discount)</div>
              </div>
            </div>

            <div className="mt-4 text-xs text-zinc-400">
              Additional perks coming: reduced cooldowns, exclusive family buffs, priority leaderboard highlights, free weekly bullets, lower jail risk.
            </div>
          </div>
        )}
      </div>
      )}
    </main>
  );
}

// Local component for family VIP buffs with proper pricing ratios
function FamilyBuffsShop({ busy, setMessage, isDonator }: { busy: boolean; setMessage: (m: string) => void; isDonator?: boolean }) {
  const [localBusy, setLocalBusy] = useState(false);
  const { refreshPlayer } = usePlayer();
  const supabase = createClient();

  // Pricing philosophy:
  // - Cash is straightforward expensive.
  // - Diamonds are premium.
  // - Bundle of diamonds is ~12-15% better value than single (subtle, only math nerds notice).
  // Single diamond power = 3.0 diamonds per 100 power
  // Bundle 600 💎 for 2400 power (~2.5 per 100) → better but not obvious.
  const buffs = [
    { id: 'power100', label: '+100 Family Power', desc: 'Direct war strength + hourly pay boost', cash: 420000, diamonds: 140, diamondsBundle: 600, bundlePower: 2400 },
    { id: 'power250', label: '+250 Family Power', desc: 'Major boost to attacks, defense and payouts', cash: 980000, diamonds: 320, diamondsBundle: 1250, bundlePower: 5200 },
    { id: 'hourly', label: 'Hourly Pay Surge (x1.25 effective)', desc: 'Temporarily raises family payout rate (stacks via power)', cash: 650000, diamonds: 210, diamondsBundle: 820, bundlePower: 3100 },
    { id: 'war', label: 'War Readiness Pack (+300 Atk/Def)', desc: 'Big advantage in upcoming Family Wars', cash: 1150000, diamonds: 380, diamondsBundle: 1400, bundlePower: 5800 },
  ];

  const buyBuff = async (buff: any, useBundle: boolean, payWith: 'cash' | 'diamonds') => {
    setLocalBusy(true);
    try {
      if (payWith === 'cash') {
        // Atomic server-side: checks + deducts the player's own cash + adds family power
        const powerGain = Math.max(5, Math.floor(buff.cash / 8000));
        const { error } = await supabase.rpc('buy_family_buff_cash', {
          cost_cash: buff.cash,
          power_gain: powerGain,
        });
        if (error) {
          if (error.message.includes('NOT_ENOUGH_CASH')) setMessage('Not enough cash.');
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage('You must be in a family to buy VIP buffs.');
          else setMessage(error.message || 'Purchase failed.');
          setLocalBusy(false);
          return;
        }
        await refreshPlayer();
        setMessage(`Bought ${buff.label} for the family. +${powerGain} power.`);
      } else {
        // Diamond path — atomic server-side: checks + deducts diamonds + adds family power
        const costD = useBundle ? buff.diamondsBundle : buff.diamonds;
        const powerGain = useBundle ? buff.bundlePower : Math.floor(buff.diamonds * 1.8);

        const { error } = await supabase.rpc('buy_family_buff_diamonds', {
          cost_diamonds: costD,
          power_gain: powerGain,
        });
        if (error) {
          if (error.message.includes('NOT_ENOUGH_DIAMONDS')) setMessage('Not enough diamonds.');
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage('You must be in a family to buy VIP buffs.');
          else setMessage(error.message || 'Purchase failed.');
          setLocalBusy(false);
          return;
        }

        const label = useBundle ? `${buff.label} (BUNDLE)` : buff.label;
        await refreshPlayer();
        setMessage(`VIP: ${label} applied to your Family. +${powerGain} power.`);
      }
    } catch (e: any) {
      setMessage(e?.message || 'Purchase failed. Must be in a family for full effect.');
    }
    setLocalBusy(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {buffs.map((b, idx) => {
        const singleD = b.diamonds;
        const bundleD = b.diamondsBundle;
        const bundleValue = Math.round((b.bundlePower / bundleD) * 100) / 100; // diamonds per power point inverse
        return (
          <div key={idx} className="card p-4 border border-amber-900/40">
            <div className="font-bold mb-0.5">{b.label}</div>
            <div className="text-xs text-zinc-400 mb-3">{b.desc}</div>

            <div className="flex flex-wrap gap-2">
              {/* Cash option */}
              <button 
                disabled={localBusy || busy} 
                onClick={() => buyBuff(b, false, 'cash')}
                className="flex-1 text-left px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm border border-zinc-700"
              >
                💵 ${(b.cash / 1000).toFixed(0)}k cash<br />
                <span className="text-[10px] text-emerald-400">Family bank conversion</span>
              </button>

              {/* Single diamonds */}
              <button 
                disabled={localBusy || busy} 
                onClick={() => buyBuff(b, false, 'diamonds')}
                className="flex-1 text-left px-3 py-2 rounded-lg bg-yellow-900/40 hover:bg-yellow-900/60 text-sm border border-yellow-800"
              >
                💎 {singleD} diamonds<br />
                <span className="text-[10px] text-amber-300">Single</span>
              </button>

              {/* Bundle diamonds (subtly smarter) — Donator exclusive full access */}
              <button 
                disabled={localBusy || busy || !isDonator} 
                onClick={() => buyBuff(b, true, 'diamonds')}
                className="flex-1 text-left px-3 py-2 rounded-lg bg-yellow-700 hover:bg-yellow-600 text-sm font-medium border border-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                💎 {bundleD} diamonds — BUNDLE { !isDonator && '(DONATOR ONLY)' }<br />
                <span className="text-[10px]">+{b.bundlePower} power • better value</span>
              </button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-2">Bundle is slightly smarter (≈12% better rate). Only noticeable if you do the math.</div>
          </div>
        );
      })}
    </div>
  );
}
