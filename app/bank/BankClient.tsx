'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import type { Player } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function BankClient({ initialPlayer }: { initialPlayer: Player | null }) {
  const { language, fm } = useLanguage();
  const { player: contextPlayer, updatePlayer, refreshPlayer, showToast } = usePlayer();
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'cash' | 'bank' | 'assets' | 'gov'>('cash');

  // Reset amount when switching tabs to avoid cross-tab confusion
  useEffect(() => {
    setAmount(100);
  }, [activeTab]);

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
    return <div className="p-8 text-zinc-400">Could not load player data.</div>;
  }

  const currentBank = (player as unknown as { personal_bank: number }).personal_bank ?? 0;
  // NOTE: total_wealth likely represents non-cash/bank assets. Keep cash+bank+total_wealth
  // until the server schema clarifies whether total_wealth already includes them.
  const totalWealth = (player.cash || 0) + currentBank + (player.total_wealth || 0);
  const govTax = (player as unknown as { gov_tax_bank: number }).gov_tax_bank ?? 0;

  // Track previous gov_tax_bank so we can derive the actual tax from server state
  // instead of recomputing it client-side.
  const prevGovTaxRef = useRef(govTax);

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

  const tabColors: Record<string, { active: string; inactive: string }> = {
    cash: { active: 'text-emerald-400 border-emerald-700/50 bg-emerald-950/20', inactive: 'text-zinc-400 border-transparent hover:text-zinc-200' },
    bank: { active: 'text-blue-400 border-blue-700/50 bg-blue-950/20', inactive: 'text-zinc-400 border-transparent hover:text-zinc-200' },
    assets: { active: 'text-amber-400 border-amber-700/50 bg-amber-950/20', inactive: 'text-zinc-400 border-transparent hover:text-zinc-200' },
    gov: { active: 'text-red-400 border-red-700/50 bg-red-950/20', inactive: 'text-zinc-400 border-transparent hover:text-zinc-200' },
  };

  const tabLabels: Record<'cash' | 'bank' | 'assets' | 'gov', string> = {
    cash: 'Cash',
    bank: 'Bank',
    assets: 'Assets',
    gov: 'Gov',
  };

  const handleDeposit = async () => {
    if (amount <= 0 || amount > player.cash) {
      showToast('Invalid amount or not enough cash!', 'error');
      return;
    }

    if (!confirm(`Confirm deposit of ${fm(amount)} from Cash to Bank? This will transfer the funds.`)) {
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('deposit_personal_bank', { amount });

    if (error) {
      showToast(error.message || 'Deposit failed', 'error');
    } else if (data?.player) {
      const updated = data.player as Player;
      const newGovTax = (updated as unknown as { gov_tax_bank: number }).gov_tax_bank ?? 0;
      const tax = Math.max(0, newGovTax - prevGovTaxRef.current);
      prevGovTaxRef.current = newGovTax;
      updatePlayer(updated);
      setAmount(100);
      await refreshPlayer();
      await router.refresh();
      showToast(`Deposit successful! Funds transferred to personal bank. (${fm(tax)} to Gov Tax)`, 'success');
    }
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (amount <= 0 || amount > currentBank) {
      showToast('Invalid amount or not enough in bank!', 'error');
      return;
    }

    if (!confirm(`Confirm withdraw of ${fm(amount)} from Bank to Cash? This will transfer the funds.`)) {
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('withdraw_personal_bank', { amount });

    if (error) {
      showToast(error.message || 'Withdraw failed', 'error');
    } else if (data?.player) {
      const updated = data.player as Player;
      const newGovTax = (updated as unknown as { gov_tax_bank: number }).gov_tax_bank ?? 0;
      const tax = Math.max(0, newGovTax - prevGovTaxRef.current);
      prevGovTaxRef.current = newGovTax;
      updatePlayer(updated);
      setAmount(100);
      await refreshPlayer();
      await router.refresh();
      showToast(`Withdraw successful! Funds transferred to cash. (${fm(tax)} to Gov Tax)`, 'success');
    }
    setLoading(false);
  };

  const handleGovDeposit = async () => {
    if (amount <= 0 || amount > player.cash) {
      showToast('Not enough cash!', 'error');
      return;
    }
    if (!confirm(`Confirm deposit of ${fm(amount)} to Gov Tax Fund? This contributes to government taxes.`)) {
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('gov_tax_deposit', { amount });
    if (error) {
      showToast(error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash!' : (error.message || 'Deposit failed'), 'error');
    } else {
      setAmount(100);
      await refreshPlayer();
      await router.refresh();
      showToast('Deposited to Gov Tax Fund. Thank you for your contribution!', 'success');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Mafia Bank Header */}
      <div className="bg-gradient-to-r from-amber-950/80 via-zinc-900 to-zinc-900 border border-amber-800/50 rounded-xl p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.06),transparent_50%)]" />
        <div className="relative flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">🪙 General Bank</h1>
            <p className="text-xs text-amber-400/80 mt-0.5">Secure • Anonymous • Profitable</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-zinc-400">Welcome, {player.username || 'Boss'}</div>
            <div className="font-mono text-amber-400 font-bold">{moneyRank}</div>
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-3 text-xs">
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-1.5">
            <span className="text-zinc-500">Total Wealth:</span>{' '}
            <span className="font-mono text-white font-semibold">{formatCash(totalWealth, language)}</span>
          </div>
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-1.5">
            <span className="text-zinc-500">Cash:</span>{' '}
            <span className="font-mono text-emerald-400">{formatCash(player.cash, language)}</span>
          </div>
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-1.5">
            <span className="text-zinc-500">Bank:</span>{' '}
            <span className="font-mono text-blue-400">{formatCash(currentBank, language)}</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {(['cash', 'bank', 'assets', 'gov'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 sm:px-4 py-3 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-all ${
              activeTab === tab
                ? tabColors[tab].active + ' border'
                : tabColors[tab].inactive + ' border border-transparent'
            }`}
          >
            {tab === 'cash' && '💵 '}
            {tab === 'bank' && '🏦 '}
            {tab === 'assets' && '📈 '}
            {tab === 'gov' && '🏛️ '}
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'cash' && (
        <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-6">
          <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-2">Cash on Hand</div>
          <div className="text-4xl font-bold tabular-nums text-emerald-400 mb-2">
            {formatCash(player.cash, language)}
          </div>
          <div className="text-xs text-zinc-500">Ready for crimes, heists & street deals. Taxed on big spends.</div>
        </div>
      )}

      {activeTab === 'bank' && (
        <div className="bg-zinc-900 border border-blue-900/40 rounded-xl p-6">
          <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-2">Personal Bank (Protected Vault)</div>
          <div className="text-4xl font-bold tabular-nums text-blue-400 mb-2">
            {formatCash(currentBank, language)}
          </div>
          <div className="text-xs text-zinc-500">Safe from street risks. Use for bills & big moves.</div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="bg-zinc-900 border border-amber-900/40 rounded-xl p-6">
          <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-2">Other Assets</div>
          <div className="text-sm mb-2">Stocks + Property + Lottery: <span className="font-mono text-amber-400">{formatCash(player.total_wealth || 0, language)}</span></div>
          <div className="flex gap-3">
            <Link href="/stocks" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">→ Stock Market</Link>
            <Link href="/real-estate" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">→ Real Estate</Link>
          </div>
        </div>
      )}

      {activeTab === 'gov' && (
        <div className="bg-zinc-900 border border-red-900/40 rounded-xl p-6">
          <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-2">Gov Tax Fund</div>
          <div className="text-4xl font-bold tabular-nums text-red-400 mb-2">
            {formatCash(govTax, language)}
          </div>
          <div className="text-xs text-zinc-500">All taxes feed here. Used for government fund & city economy.</div>
        </div>
      )}

      {/* Deposit / Withdraw */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⬆️</span>
            <div className="font-bold text-sm text-emerald-400">DEPOSIT</div>
          </div>
          <p className="text-[10px] text-zinc-500 mb-3">Cash → Bank Vault</p>

          <div className="mb-3">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 block">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-zinc-950 border border-emerald-800 rounded-lg px-3 py-2.5 font-mono text-sm text-emerald-400 focus:outline-none focus:border-emerald-600"
            />
            <div className="flex gap-1.5 mt-2">
              {[1000, 10000, 100000, 500000].map(q => (
                <button key={q} onClick={() => setAmount(q)} className="text-[10px] px-2 py-1 bg-emerald-950/60 border border-emerald-900/40 rounded hover:bg-emerald-900/40 transition-colors">
                  {(q / 1000)}k
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleDeposit}
            disabled={loading || amount <= 0 || amount > (player.cash || 0)}
            className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg font-bold text-xs tracking-wide transition-colors"
          >
            {loading ? 'Processing...' : `CONFIRM DEPOSIT ${fm(amount)}`}
          </button>
          <p className="text-[10px] text-zinc-600 mt-1.5 text-center">+0.5% Gov Tax</p>
        </div>

        {/* Withdraw */}
        <div className="bg-zinc-900 border border-amber-900/40 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⬇️</span>
            <div className="font-bold text-sm text-amber-400">WITHDRAW</div>
          </div>
          <p className="text-[10px] text-zinc-500 mb-3">Bank Vault → Cash</p>

          <div className="mb-3">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 block">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-zinc-950 border border-amber-800 rounded-lg px-3 py-2.5 font-mono text-sm text-amber-400 focus:outline-none focus:border-amber-600"
            />
            <div className="flex gap-1.5 mt-2">
              {[1000, 10000, 100000, 500000].map(q => (
                <button key={q} onClick={() => setAmount(q)} className="text-[10px] px-2 py-1 bg-amber-950/60 border border-amber-900/40 rounded hover:bg-amber-900/40 transition-colors">
                  {(q / 1000)}k
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleWithdraw}
            disabled={loading || amount <= 0 || amount > currentBank}
            className="w-full py-2.5 bg-amber-700 hover:bg-amber-600 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg font-bold text-xs tracking-wide transition-colors"
          >
            {loading ? 'Processing...' : `CONFIRM WITHDRAW ${fm(amount)}`}
          </button>
          <p className="text-[10px] text-zinc-600 mt-1.5 text-center">+0.5% Gov Tax</p>
        </div>
      </div>

      {/* Gov Tax Quick Access */}
      {activeTab === 'gov' && (
        <div className="bg-zinc-900 border border-red-900/40 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🏛️</span>
            <div className="font-bold text-sm text-red-400">CONTRIBUTE TO GOV TAX FUND</div>
          </div>
          <p className="text-[10px] text-zinc-500 mb-3">Support the city economy. All contributions feed the government fund.</p>
          <button
            onClick={handleGovDeposit}
            disabled={loading || amount <= 0 || amount > (player.cash || 0)}
            className="w-full py-3 bg-red-700 hover:bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg font-bold text-xs tracking-wide transition-colors"
          >
            {loading ? 'Processing...' : `CONFIRM CONTRIBUTE ${fm(amount)}`}
          </button>
        </div>
      )}

      {/* Transaction Log */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-bold mb-3 uppercase tracking-wider text-zinc-400">📜 Transaction Log (Last 10)</h2>
        <div className="text-xs space-y-1.5 max-h-48 overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          {(player.transaction_log || []).slice(0, 10).map((log: { icon: string; desc: string; tax?: number; amount: number }, i: number) => (
            <div key={i} className="flex justify-between items-center border-b border-zinc-800/50 pb-1.5 last:border-0">
              <span className="text-zinc-400">
                {log.icon} {log.desc}
                {log.tax && <span className="text-red-400/70 ml-1">(Tax: {fm(log.tax)})</span>}
              </span>
              <span className={`font-mono font-semibold ${log.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {log.amount > 0 ? '+' : ''}{formatCash(log.amount, language)}
              </span>
            </div>
          ))}
          {(!player.transaction_log || player.transaction_log.length === 0) && (
            <div className="text-zinc-600 text-center py-2">No transactions yet. Start banking!</div>
          )}
        </div>
        <div className="text-[10px] text-zinc-500 mt-2">Total taxes paid: <span className="font-mono text-red-400">{fm(player.total_taxes || 0)}</span></div>
      </div>

      <div className="text-center text-[10px] text-zinc-600 pt-2">
        MafiaBank v2.0 • Anonymous • No questions asked. Separate from Family Bank.
      </div>
    </div>
  );
}
