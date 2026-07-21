'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatCash } from '@/lib/format';
import PageHeader from '../components/PageHeader';

type Txn = { icon: string; desc: string; amount: number; tax?: number; at?: string };

type Filter = 'all' | 'personal' | 'property' | 'gov' | 'piggy';

export const dynamic = 'force-dynamic';

const FILTERS: { key: Filter; label: string; icon: string; match: (t: Txn) => boolean }[] = [
  { key: 'all', label: 'All', icon: '📋', match: () => true },
  { key: 'personal', label: 'Personal Bank', icon: '🏦', match: (t) => t.desc.includes('bank') && !t.desc.includes('Property') && !t.desc.includes('Gov') && !t.desc.includes('Piggy') },
  { key: 'property', label: 'Property Bank', icon: '🏢', match: (t) => t.desc.includes('Property') },
  { key: 'gov', label: 'Gov Tax', icon: '🏛️', match: (t) => t.desc.includes('Gov Tax') || t.desc.includes('gov_tax') },
  { key: 'piggy', label: 'Piggy Bank', icon: '🐷', match: (t) => t.desc.includes('Piggy') },
];

export default function TransactionsPage() {
  const { t, language, fm } = useLanguage();
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_my_player');
      if (data?.transaction_log) {
        setTransactions((data as { transaction_log: Txn[] }).transaction_log);
      }
      setLoading(false);
    };
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, []);

  const filtered = filter === 'all' ? transactions : transactions.filter(FILTERS.find((f) => f.key === filter)!.match);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <PageHeader title={t('menu_transactions')} subtitle={t('transactions_subtitle')} icon="📜" />
        <div className="text-zinc-400 text-sm">{t('loading')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <PageHeader
        title={t('menu_transactions')}
        subtitle={t('transactions_subtitle', { count: transactions.length })}
        icon="📜"
      />

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === f.key
                ? 'bg-amber-700 text-white border border-amber-600'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
            }`}
          >
            <span className="mr-1">{f.icon}</span>
            {f.label}
            <span className="ml-1 text-[10px] opacity-70">
              ({f.key === 'all' ? transactions.length : filtered.length})
            </span>
          </button>
        ))}
      </div>

      {/* Transaction list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">No transactions found for this filter.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {filtered.map((txn, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{txn.icon}</span>
                  <div>
                    <div className="text-sm text-zinc-200">{txn.desc}</div>
                    {txn.tax && <div className="text-[10px] text-red-400/70">Tax: {fm(txn.tax)}</div>}
                    {txn.at && (
                      <div className="text-[10px] text-zinc-500">
                        {new Date(txn.at).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <span className={`font-mono font-semibold text-sm ${txn.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {txn.amount > 0 ? '+' : ''}{formatCash(txn.amount, language)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-center text-[10px] text-zinc-600 pt-2">
        MafiaBank Transaction History • Auto-refreshes every 15s
      </div>
    </div>
  );
}
