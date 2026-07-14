'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';
import type { Player } from '@/lib/types';

export default function BankClient({ initialPlayer, email }: { initialPlayer: Player | null; email: string }) {
  const { t } = useLanguage();
  const { player: contextPlayer, updatePlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'cash' | 'bank' | 'assets' | 'gov'>('cash');

  // Use context player as source of truth for live updates (persists across navigations).
  // Fall back to server initialPlayer.
  const player = contextPlayer || initialPlayer;

  // Sync initial server data into context if context is empty
  useEffect(() => {
    if (initialPlayer && !contextPlayer) {
      updatePlayer(initialPlayer);
    }
  }, [initialPlayer, contextPlayer, updatePlayer]);

  if (!player) {
    return <div className="p-8">Could not load player data.</div>;
  }

  const playerId = player.id;
  const currentBank = (player as any).personal_bank ?? 0;
  const totalWealth = (player.cash || 0) + currentBank + (player.total_wealth || 0);
  const govTax = (player as any).gov_tax_bank ?? 0;

  // Funny money rank
  const getMoneyRank = (wealth: number) => {
    if (wealth < 1000) return 'Hobo (Broke but Free)';
    if (wealth < 10000) return 'Street Rat (Hustlin\' Hard)';
    if (wealth < 50000) return 'Small Time Hustler (Stackin\' Paper)';
    if (wealth < 200000) return 'Gangster (Respect the Bag)';
    if (wealth < 1000000) return 'Made Man (Money Talks)';
    return 'Kingpin (The Bank Owns You Now)';
  };

  const moneyRank = getMoneyRank(totalWealth);

  const handleDeposit = async () => {
    if (amount <= 0 || amount > player.cash) {
      alert('Invalid amount or not enough cash!');
      return;
    }

    if (!confirm(`Confirm deposit of $${amount} from Cash to Bank? This will transfer the funds.`)) {
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('deposit_personal_bank', { amount });

    if (error) {
      alert(error.message || 'Deposit failed');
    } else if (data?.player) {
      const updated = data.player as Player;
      // Tax is now applied inside the RPC atomically
      const tax = Math.floor(amount * 0.005);
      updatePlayer(updated);
      setAmount(100);
      await refreshPlayer();
      alert(`Deposit successful! Funds transferred to personal bank. ($${tax} to Gov Tax)`);
    }
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (amount <= 0 || amount > currentBank) {
      alert('Invalid amount or not enough in bank!');
      return;
    }

    if (!confirm(`Confirm withdraw of $${amount} from Bank to Cash? This will transfer the funds.`)) {
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('withdraw_personal_bank', { amount });

    if (error) {
      alert(error.message || 'Withdraw failed');
    } else if (data?.player) {
      const updated = data.player as Player;
      // Tax is now applied inside the RPC atomically
      const tax = Math.floor(amount * 0.005);
      updatePlayer(updated);
      setAmount(100);
      await refreshPlayer();
      alert(`Withdraw successful! Funds transferred to cash. ($${tax} to Gov Tax)`);
    }
    setLoading(false);
  };

  const handleGovDeposit = async () => {
    if (amount <= 0 || amount > player.cash) {
      alert('Invalid amount or not enough cash!');
      return;
    }
    if (!confirm(`Confirm deposit of $${amount} to Gov Tax Fund? This contributes to government taxes.`)) {
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('gov_tax_deposit', { amount });
    if (error) {
      alert(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : (error.message || 'Deposit failed'));
    } else {
      setAmount(100);
      await refreshPlayer();
      alert('Deposited to Gov Tax Fund. Thank you for your contribution!');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Online Banking App Style Header */}
      <div className="mb-6 bg-gradient-to-r from-zinc-900 to-black p-4 rounded-xl border border-zinc-700">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">🪙 General Bank • MafiaBank Online</h1>
            <p className="text-xs text-emerald-400">Secure • Anonymous • Profitable</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-zinc-400">Welcome, {player.username || 'Boss'}</div>
            <div className="font-mono text-emerald-400 text-lg">Money Rank: {moneyRank}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-zinc-500">Total Wealth: ${formatCash(totalWealth, 'en')} (Cash + Bank + Assets)</div>
        <div className="mt-1 text-[10px] text-emerald-300/70">Tip: Personal Bank is safer. Small tax applies on moves. Use Confirm buttons for big transfers. All losses feed the Dev's central Casino Bank.</div>
      </div>

      {/* Tabs like banking app */}
      <div className="flex border-b border-zinc-700 mb-4">
        {['cash', 'bank', 'assets', 'gov'].map(tab => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-6 py-2 text-sm font-semibold capitalize ${activeTab === tab ? 'border-b-2 border-red-600 text-white' : 'text-zinc-400'}`}
          >
            {tab === 'cash' ? '💵 Cash' : tab === 'bank' ? '🏦 Bank' : tab === 'assets' ? '📈 Assets (Stocks/Lottery)' : '🏛️ Gov Tax Fund'}
          </button>
        ))}
      </div>

      {activeTab === 'cash' && (
        <div className="card p-6 mb-4">
          <div className="text-sm text-zinc-500 mb-1">CASH ON HAND</div>
          <div className="text-5xl font-bold tabular-nums text-emerald-400 mb-2">
            ${formatCash(player.cash, 'en')}
          </div>
          <div className="text-xs text-zinc-500">Ready for crimes, heists & street deals. Taxed on big spends (1-2% to Community Fund).</div>
        </div>
      )}

      {activeTab === 'bank' && (
        <div className="card p-6 mb-4 border border-emerald-800">
          <div className="text-sm text-emerald-400 mb-1">PERSONAL BANK (Protected Vault)</div>
          <div className="text-5xl font-bold tabular-nums text-emerald-400 mb-2">
            ${formatCash(currentBank, 'en')}
          </div>
          <div className="text-xs text-zinc-500 mb-4">Safe from street risks. Earn interest soon. Use for bills & big moves.</div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="card p-6 mb-4">
          <div className="text-sm text-yellow-400 mb-1">OTHER ASSETS</div>
          <div className="text-sm">Stocks + Property + Lottery: <span className="font-mono">${formatCash(player.total_wealth || 0, 'en')}</span></div>
          <div className="mt-2">
            <Link href="/stocks" className="text-emerald-400 hover:underline text-sm">→ Open Advanced Stock Market (full working)</Link>
          </div>
          <div className="text-xs text-zinc-500 mt-2">Trade live economy-driven stocks. Prices react to crimes, families, heists, real estate and casino play.</div>
        </div>
      )}

      {activeTab === 'gov' && (
        <div className="card p-6 mb-4">
          <div className="text-sm text-purple-400 mb-1">GOV TAX FUND (Dev Managed)</div>
          <div className="text-5xl font-bold tabular-nums text-purple-400 mb-2">
            ${formatCash(govTax, 'en')}
          </div>
          <div className="text-xs text-zinc-500 mb-4">All tax related banking, buys, sells (except Piggy deposits) feed here. Used for government fund.</div>
          <div className="text-xs">Personal, Family, and other bank losses contribute to Gov Tax. Piggy withdraws too (0.8%).</div>
        </div>
      )}

      {/* General Banking - Full Banking App Style for all players */}
      <div className="card p-6 border border-emerald-900/50">
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">🏦 General Bank - MafiaBank</h2>
        <p className="text-sm text-zinc-400 mb-4">Secure personal banking for every player. Deposit cash for safety, withdraw when needed. Small gov tax applies on transactions.</p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Deposit Section */}
          <div className="bg-zinc-950 border border-emerald-800 rounded-2xl p-5">
            <div className="text-emerald-400 font-semibold mb-1 flex items-center gap-2">⬆ DEPOSIT (Cash → Bank Vault)</div>
            <div className="text-xs text-zinc-500 mb-3">Move cash into protected bank. Safer from streets.</div>
            
            <div className="mb-3">
              <label className="text-xs text-zinc-400">Enter Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full mt-1 bg-black border border-emerald-700 rounded-xl px-4 py-3 text-2xl font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                placeholder="0"
              />
              <div className="flex gap-2 mt-2">
                {[1000, 10000, 100000, 500000].map(q => (
                  <button key={q} onClick={() => setAmount(q)} className="text-xs px-2 py-1 bg-emerald-900/50 rounded hover:bg-emerald-800">+${(q/1000)}k</button>
                ))}
              </div>
            </div>

            <button
              onClick={handleDeposit}
              disabled={loading || amount <= 0 || amount > (player.cash || 0)}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 rounded-2xl font-bold text-lg flex items-center justify-center gap-2"
            >
              {loading ? 'Processing...' : `CONFIRM DEPOSIT $${amount.toLocaleString()}`}
            </button>
            <div className="text-[10px] text-zinc-500 mt-1 text-center">+0.5% to Gov Tax Fund. Requires confirmation.</div>
          </div>

          {/* Withdraw Section */}
          <div className="bg-zinc-950 border border-amber-800 rounded-2xl p-5">
            <div className="text-amber-400 font-semibold mb-1 flex items-center gap-2">⬇ WITHDRAW (Bank Vault → Cash)</div>
            <div className="text-xs text-zinc-500 mb-3">Take money out for street use, crimes, purchases.</div>
            
            <div className="mb-3">
              <label className="text-xs text-zinc-400">Enter Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full mt-1 bg-black border border-amber-700 rounded-xl px-4 py-3 text-2xl font-mono text-amber-400 focus:outline-none focus:border-amber-500"
                placeholder="0"
              />
              <div className="flex gap-2 mt-2">
                {[1000, 10000, 100000, 500000].map(q => (
                  <button key={q} onClick={() => setAmount(q)} className="text-xs px-2 py-1 bg-amber-900/50 rounded hover:bg-amber-800">+${(q/1000)}k</button>
                ))}
              </div>
            </div>

            <button
              onClick={handleWithdraw}
              disabled={loading || amount <= 0 || amount > currentBank}
              className="w-full bg-amber-700 hover:bg-amber-600 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 rounded-2xl font-bold text-lg flex items-center justify-center gap-2"
            >
              {loading ? 'Processing...' : `CONFIRM WITHDRAW $${amount.toLocaleString()}`}
            </button>
            <div className="text-[10px] text-zinc-500 mt-1 text-center">+0.5% to Gov Tax Fund. Requires confirmation.</div>
          </div>
        </div>

        {/* Gov Tax quick access if selected */}
        {activeTab === 'gov' && (
          <div className="mt-4 p-4 bg-purple-950/30 border border-purple-800 rounded-xl">
            <button
              onClick={handleGovDeposit}
              disabled={loading || amount <= 0 || amount > (player.cash || 0)}
              className="w-full bg-purple-700 hover:bg-purple-600 py-3 rounded-2xl font-bold"
            >
              {loading ? '...' : `CONFIRM CONTRIBUTE $${amount.toLocaleString()} TO GOV TAX FUND`}
            </button>
          </div>
        )}

        <div className="mt-4 text-xs text-zinc-500 bg-zinc-950 p-3 rounded">
          This is the <strong>General Bank</strong> every player has access to. Separate from Family Bank (in Families page) and Piggybank (Mansion only). All moves are confirmed. Taxes support the city economy.
        </div>
      </div>

      {/* Transaction Log last 10 - Online Banking style */}
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-4">📜 Transaction Log (Last 10)</h2>
        <div className="text-xs space-y-1 max-h-40 overflow-auto bg-zinc-950 p-2 rounded">
          {(player.transaction_log || []).slice(0,10).map((log: any, i: number) => (
            <div key={i} className="flex justify-between border-b border-zinc-800 pb-1">
              <span>{log.icon} {log.desc} {log.tax ? `(Tax: $${log.tax})` : ''}</span>
              <span className="font-mono">{log.amount > 0 ? '+' : ''}${log.amount}</span>
            </div>
          ))}
          {(!player.transaction_log || player.transaction_log.length === 0) && <div className="text-zinc-500">No transactions yet. Start banking!</div>}
        </div>
        <div className="text-xs mt-2">Total taxes paid: ${(player.total_taxes || 0).toLocaleString()}</div>
      </div>

      <div className="text-center text-sm text-zinc-500 mt-4">
        MafiaBank v2.0 • Anonymous • No questions asked. Separate from Family Bank.
      </div>
    </div>
  );
}
