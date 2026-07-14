'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Bid {
  propertyId: string;
  name: string;
  currentBid: number;
  bidder: string;
  timeLeft: number; // minutes
}

export default function MarketplacePage() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const [bids, setBids] = useState<Bid[]>([
    { propertyId: '1', name: 'New York Train Station', currentBid: 25000, bidder: 'PlayerX', timeLeft: 45 },
    { propertyId: '2', name: 'Chicago Metal Factory', currentBid: 42000, bidder: 'BossY', timeLeft: 120 },
  ]);
  const [bidAmount, setBidAmount] = useState(0);
  const [instantBuyPrice, setInstantBuyPrice] = useState(0);
  const [auctionTime, setAuctionTime] = useState(1); // hours
  const [selected, setSelected] = useState<string>('');
  const [message, setMessage] = useState('');

  // NOTE: real auctions need a server-side auctions table (roadmap).
  // The old demo deducted real cash without giving anything back —
  // now it's a visual preview that never touches your money.
  const placeBid = (prop: Bid) => {
    if (!player || bidAmount <= prop.currentBid) {
      setMessage(t('market_bid_too_low'));
      return;
    }
    const newBids = bids.map(b =>
      b.propertyId === prop.propertyId
        ? { ...b, currentBid: bidAmount, bidder: player.username || 'You', timeLeft: auctionTime * 60 }
        : b
    );
    setBids(newBids);
    setMessage(t('market_bid_preview', { amount: `$${bidAmount}` }));
    setBidAmount(0);
  };

  const instantBuy = (prop: Bid) => {
    if (!player || !instantBuyPrice) {
      setMessage(t('market_instant_first'));
      return;
    }
    setMessage(t('market_instant_preview', { name: prop.name, price: `$${instantBuyPrice}` }));
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏛️ {t('market_title')} <span className="text-xs align-middle px-2 py-0.5 bg-amber-900/50 text-amber-400 rounded">{t('market_preview_badge')}</span></h1>
      <p className="text-sm text-zinc-400 mb-6">{t('market_desc')}</p>

      <div className="mb-4 flex gap-3 items-end">
        <div>
          <label className="text-xs block mb-1">{t('market_auction_duration')}</label>
          <select value={auctionTime} onChange={e => setAuctionTime(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 px-3 py-1 rounded text-sm">
            <option value={1}>{t('market_1hour')}</option>
            <option value={2}>{t('market_2hours')}</option>
            <option value={3}>{t('market_3hours')}</option>
            <option value={5}>{t('market_5hours')}</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4">
        {bids.map((bid, i) => (
          <div key={i} className="card p-5">
            <div className="flex justify-between mb-3">
              <div>
                <h3 className="font-bold">{bid.name}</h3>
                <p className="text-xs">{t('market_current_bid', { bid: `$${bid.currentBid}`, bidder: bid.bidder })}</p>
                <p className="text-xs text-orange-400">{t('market_time_left', { minutes: bid.timeLeft })}</p>
              </div>
            </div>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <input 
                  type="number" 
                  value={bidAmount} 
                  onChange={e => { setBidAmount(parseInt(e.target.value) || 0); setSelected(bid.propertyId); }}
                  className="w-full bg-zinc-900 border border-zinc-700 px-3 py-1 text-sm rounded"
                  placeholder={t('market_bid_placeholder')}
                />
              </div>
              <button onClick={() => placeBid(bid)} className="px-4 py-1 bg-red-700 rounded text-sm">{t('market_place_bid')}</button>
            </div>

            <div className="mt-3 flex gap-2">
              <input 
                type="number" 
                value={instantBuyPrice} 
                onChange={e => setInstantBuyPrice(parseInt(e.target.value) || 0)}
                className="flex-1 bg-zinc-900 border border-zinc-700 px-3 py-1 text-sm rounded"
                placeholder={t('market_instant_placeholder')}
              />
              <button onClick={() => instantBuy(bid)} className="px-4 py-1 bg-emerald-700 rounded text-sm">{t('market_instant_buy')}</button>
            </div>
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        {t('market_footer')}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
