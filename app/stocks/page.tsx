'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { createClient } from '@/lib/supabase/client';
import { formatCash } from '@/lib/format';

type Stock = {
  ticker: string;
  name: string;
  current_price: number;
  prev_price: number;
  volatility: number;
};

export default function StocksPage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sharesInput, setSharesInput] = useState<Record<string, number>>({});

  const supabase = createClient();

  const loadMarket = async () => {
    try {
      const { data, error } = await supabase.rpc('get_stock_market');
      if (error) throw error;
      if (data) setStocks(data as any);
      // Advance market a bit on load for live feel (economy based)
      try { await supabase.rpc('advance_stock_market'); } catch {}
      const { data: d2 } = await supabase.rpc('get_stock_market');
      if (d2) setStocks(d2 as any);
    } catch (e: any) {
      setMsg('Stock market tables not created yet. Run the latest migration (FIX_034_stocks_table.sql or 034_stock_market_casino_economy_admin.sql). ' + (e.message || ''));
      // Fallback demo data so page isn't empty
      if (stocks.length === 0) {
        setStocks([
          { ticker: 'GOTHAM', name: 'Gotham Realty Trust', current_price: 142.50, prev_price: 140.00, volatility: 0.025 },
          { ticker: 'PHARMA', name: 'Street Pharma Co.', current_price: 67.80, prev_price: 71.20, volatility: 0.06 },
        ] as any);
      }
    }
  };

  const loadHoldings = () => {
    if (player?.stock_holdings) setHoldings(player.stock_holdings as any);
  };

  useEffect(() => {
    loadMarket();
    loadHoldings();
  }, [player]);

  const getShares = (t: string) => sharesInput[t] || 1;

  const setShares = (t: string, v: number) => setSharesInput(prev => ({ ...prev, [t]: Math.max(1, Math.floor(v)) }));

  const buy = async (ticker: string) => {
    if (!player) return;
    const shares = getShares(ticker);
    setBusy(true);
    setMsg('');
    try {
      const { data, error } = await supabase.rpc('buy_stock', { p_ticker: ticker, shares });
      if (error) throw error;
      updatePlayer(data.player);
      await refreshPlayer();
      setMsg(`Bought ${shares} ${ticker} shares.`);
      await loadMarket();
    } catch (e: any) {
      setMsg(e.message || 'Buy failed');
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
      updatePlayer(data.player);
      await refreshPlayer();
      setMsg(`Sold ${shares} ${ticker}.`);
      await loadMarket();
    } catch (e: any) { setMsg(e.message || 'Sell failed'); }
    setBusy(false);
  };

  const portfolioValue = () => {
    let v = 0;
    stocks.forEach(s => {
      const sh = holdings[s.ticker] || 0;
      v += sh * s.current_price;
    });
    return v;
  };

  const nudgeStock = async (ticker: string, pct: number) => {
    // Direct update for specific driver effect (server RPC would be ideal in prod)
    try {
      const stock = stocks.find(st => st.ticker === ticker);
      if (!stock) return;
      const newP = Math.max(3, Math.round((stock.current_price * (1 + pct / 100)) * 100) / 100);
      await supabase.from('stocks').update({ current_price: newP, prev_price: stock.current_price, last_tick: new Date().toISOString() }).eq('ticker', ticker);
      setMsg(`Market mover: ${ticker} ${pct > 0 ? '+' : ''}${pct}%`);
    } catch {}
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">📈 UNDERWORLD STOCK EXCHANGE</h1>
      <p className="text-sm text-zinc-400 mb-4">Prices driven by family power, crime volume, and live market ticks. Buy low. Sell high. Real money. Real risk.</p>

      <div className="mb-4 card p-4">
        <div className="text-xs">Your Portfolio Value: <span className="font-mono text-emerald-400">${portfolioValue().toLocaleString()}</span></div>
        <div className="text-xs text-zinc-500">Holdings update on every trade. Advance the market by playing the game or refreshing here.</div>
        {msg && msg.includes('not created') && (
          <div className="mt-2 text-amber-400 text-xs border border-amber-700 p-2 rounded">
            ⚠️ Demo data shown. Real stock market requires running the migration first.
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stocks.map((s) => {
          const owned = holdings[s.ticker] || 0;
          const change = s.prev_price ? ((s.current_price - s.prev_price) / s.prev_price * 100) : 0;
          return (
            <div key={s.ticker} className="card p-5">
              <div className="flex justify-between">
                <div>
                  <div className="font-bold">{s.name} <span className="font-mono text-xs text-zinc-500">({s.ticker})</span></div>
                  <div className="text-3xl font-mono mt-1">${s.current_price.toFixed(2)}</div>
                </div>
                <div className={`text-right ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                </div>
              </div>

              <div className="text-xs mt-3 mb-2">You own: <span className="font-mono">{owned}</span> shares</div>

              <div className="flex items-center gap-2 mb-2">
                <input type="number" value={getShares(s.ticker)} onChange={e => setShares(s.ticker, parseInt(e.target.value) || 1)} className="w-20 bg-zinc-950 border px-2 py-1 text-sm" />
                <button onClick={() => buy(s.ticker)} disabled={busy} className="flex-1 py-1.5 bg-emerald-700 rounded text-sm">BUY</button>
                <button onClick={() => sell(s.ticker)} disabled={busy || owned < 1} className="flex-1 py-1.5 bg-red-700 rounded text-sm disabled:opacity-50">SELL</button>
              </div>

              <div className="text-[10px] text-zinc-500">Volatility: {(s.volatility * 100).toFixed(1)}% • Economy-tied</div>
            </div>
          );
        })}
      </div>

      {msg && <div className="mt-4 p-3 bg-zinc-900 border rounded text-sm">{msg}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        Market moves with the city: more crimes + stronger families = upward pressure. Losses from casino also subtly affect CASROY.
        <br />Specific drivers active: Real Estate buys → GOTHAM up. Drug sales → PHARMA. Family power buys → FAMPOW. Heists → HEISTX. Racing → RACERZ. Casino play → CASROY.
      </div>

      <div className="mt-4 card p-4">
        <div className="text-xs font-semibold mb-2">MARKET ACTIVITY (In-game actions move these live)</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={async () => { await nudgeStock('GOTHAM', 3.2); await loadMarket(); }} className="px-3 py-1 bg-zinc-800 rounded">Real Estate boom (+GOTHAM)</button>
          <button onClick={async () => { await nudgeStock('PHARMA', 2.8); await loadMarket(); }} className="px-3 py-1 bg-zinc-800 rounded">Street sales spike (+PHARMA)</button>
          <button onClick={async () => { await nudgeStock('FAMPOW', 4); await loadMarket(); }} className="px-3 py-1 bg-zinc-800 rounded">Family power surge (+FAMPOW)</button>
          <button onClick={async () => { await nudgeStock('CASROY', -1.5); await loadMarket(); }} className="px-3 py-1 bg-zinc-800 rounded">Big casino losses (+CASROY slow)</button>
        </div>
      </div>

      <Link href="/bank" className="mt-4 inline-block text-red-400 text-sm">← Back (or check Bank Assets)</Link>
    </div>
  );
}
