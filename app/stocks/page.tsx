'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';

type Stock = {
  ticker: string;
  name: string;
  current_price: number;
  prev_price: number;
  volatility: number;
};

type TradeResult = {
  player: Player;
};

export default function StocksPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [sharesInput, setSharesInput] = useState<Record<string, number>>({});

  const supabase = createClient();

  const loadMarket = async () => {
    try {
      const { data, error } = await supabase.rpc('get_stock_market');
      if (error) throw error;
      if (data) setStocks(data as Stock[]);
      // Advance market a bit on load for live feel (economy based)
      try {
        await supabase.rpc('advance_stock_market');
      } catch {}
      const { data: d2 } = await supabase.rpc('get_stock_market');
      if (d2) setStocks(d2 as Stock[]);
    } catch (e) {
      setMigrationMissing(true);
      setMsg(`${t('stocks_migration_error')} ${e instanceof Error ? e.message : ''}`);
      // Fallback demo data so page isn't empty
      if (stocks.length === 0) {
        setStocks([
          {
            ticker: 'GOTHAM',
            name: 'Gotham Realty Trust',
            current_price: 142.5,
            prev_price: 140.0,
            volatility: 0.025,
          },
          {
            ticker: 'PHARMA',
            name: 'Street Pharma Co.',
            current_price: 67.8,
            prev_price: 71.2,
            volatility: 0.06,
          },
        ]);
      }
    }
  };

  const loadHoldings = () => {
    if (player?.stock_holdings) setHoldings(player.stock_holdings);
  };

  useEffect(() => {
    loadMarket();
    loadHoldings();
  }, [player]);

  const getShares = (ticker: string) => sharesInput[ticker] || 1;

  const setShares = (ticker: string, v: number) =>
    setSharesInput((prev) => ({ ...prev, [ticker]: Math.max(1, Math.floor(v)) }));

  const buy = async (ticker: string) => {
    if (!player) return;
    const shares = getShares(ticker);
    setBusy(true);
    setMsg('');
    try {
      const { data, error } = await supabase.rpc('buy_stock', { p_ticker: ticker, shares });
      if (error) throw error;
      updatePlayer((data as TradeResult).player);
      await refreshPlayer();
      setMsg(t('stocks_bought', { shares, ticker }));
      await loadMarket();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('stocks_buy_failed'));
    }
    setBusy(false);
  };

  const sell = async (ticker: string) => {
    if (!player) return;
    const shares = getShares(ticker);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('sell_stock', { p_ticker: ticker, shares });
      if (error) throw error;
      updatePlayer((data as TradeResult).player);
      await refreshPlayer();
      setMsg(t('stocks_sold', { shares, ticker }));
      await loadMarket();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('stocks_sell_failed'));
    }
    setBusy(false);
  };

  const portfolioValue = () => {
    let v = 0;
    stocks.forEach((s) => {
      const sh = holdings[s.ticker] || 0;
      v += sh * s.current_price;
    });
    return v;
  };

  const isAdmin = player?.username === 'YGhosty';

  const nudgeStock = async (ticker: string, pct: number) => {
    // Admin-only market mover via RPC (direct table writes are blocked by RLS)
    const { error } = await supabase.rpc('admin_nudge_stock', { p_ticker: ticker, pct });
    if (error) {
      setMsg(
        error.message.includes('NOT_AUTHORIZED')
          ? t('stocks_admin_only')
          : error.message || t('stocks_move_failed'),
      );
      return;
    }
    setMsg(t('stocks_market_mover', { ticker, pct: `${pct > 0 ? '+' : ''}${pct}` }));
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-1">📈 {t('stocks_title')}</h1>
      <p className="text-sm text-zinc-400 mb-4">{t('stocks_desc')}</p>

      <div className="mb-4 card p-4">
        <div className="text-xs">
          {t('stocks_portfolio_value')}{' '}
          <span className="font-mono text-emerald-400">${portfolioValue().toLocaleString()}</span>
        </div>
        <div className="text-xs text-zinc-500">{t('stocks_portfolio_note')}</div>
        {migrationMissing && (
          <div className="mt-2 text-amber-400 text-xs border border-amber-700 p-2 rounded">
            {t('stocks_demo_warning')}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stocks.map((s) => {
          const owned = holdings[s.ticker] || 0;
          const change = s.prev_price
            ? ((s.current_price - s.prev_price) / s.prev_price) * 100
            : 0;
          return (
            <div key={s.ticker} className="card p-5">
              <div className="flex justify-between">
                <div>
                  <div className="font-bold">
                    {s.name} <span className="font-mono text-xs text-zinc-500">({s.ticker})</span>
                  </div>
                  <div className="text-3xl font-mono mt-1">${s.current_price.toFixed(2)}</div>
                </div>
                <div className={`text-right ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(1)}%
                </div>
              </div>

              <div className="text-xs mt-3 mb-2">
                {t('stocks_you_own')} <span className="font-mono">{owned}</span> {t('stocks_shares')}
              </div>

              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  value={getShares(s.ticker)}
                  onChange={(e) => setShares(s.ticker, parseInt(e.target.value) || 1)}
                  className="w-20 bg-zinc-950 border px-2 py-1 text-sm"
                />
                <button
                  onClick={() => buy(s.ticker)}
                  disabled={busy}
                  className="flex-1 py-1.5 bg-emerald-700 rounded text-sm"
                >
                  {t('stocks_buy')}
                </button>
                <button
                  onClick={() => sell(s.ticker)}
                  disabled={busy || owned < 1}
                  className="flex-1 py-1.5 bg-red-700 rounded text-sm disabled:opacity-50"
                >
                  {t('stocks_sell')}
                </button>
              </div>

              <div className="text-[10px] text-zinc-500">
                {t('stocks_volatility', { pct: (s.volatility * 100).toFixed(1) })}
              </div>
            </div>
          );
        })}
      </div>

      {msg && <div className="mt-4 p-3 bg-zinc-900 border rounded text-sm">{msg}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        {t('stocks_footer_1')}
        <br />
        {t('stocks_footer_2')}
      </div>

      {isAdmin && (
        <div className="mt-4 card p-4 border border-amber-900/50">
          <div className="text-xs font-semibold mb-2">{t('stocks_admin_title')}</div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={async () => {
                await nudgeStock('GOTHAM', 3.2);
                await loadMarket();
              }}
              className="px-3 py-1 bg-zinc-800 rounded"
            >
              {t('stocks_admin_gotham')}
            </button>
            <button
              onClick={async () => {
                await nudgeStock('PHARMA', 2.8);
                await loadMarket();
              }}
              className="px-3 py-1 bg-zinc-800 rounded"
            >
              {t('stocks_admin_pharma')}
            </button>
            <button
              onClick={async () => {
                await nudgeStock('FAMPOW', 4);
                await loadMarket();
              }}
              className="px-3 py-1 bg-zinc-800 rounded"
            >
              {t('stocks_admin_fampow')}
            </button>
            <button
              onClick={async () => {
                await nudgeStock('CASROY', -1.5);
                await loadMarket();
              }}
              className="px-3 py-1 bg-zinc-800 rounded"
            >
              {t('stocks_admin_casroy')}
            </button>
          </div>
        </div>
      )}

      <Link href="/bank" className="mt-4 inline-block text-red-400 text-sm">
        {t('stocks_back')}
      </Link>
    </div>
  );
}
