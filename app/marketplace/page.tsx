'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';

interface Bid {
  propertyId: string;
  name: string;
  currentBid: number;
  bidder: string;
  timeLeft: number; // minutes
}

export default function MarketplacePage() {
  const { player, updatePlayer } = usePlayer();
  const [bids, setBids] = useState<Bid[]>([
    { propertyId: '1', name: 'New York Train Station', currentBid: 25000, bidder: 'PlayerX', timeLeft: 45 },
    { propertyId: '2', name: 'Chicago Metal Factory', currentBid: 42000, bidder: 'BossY', timeLeft: 120 },
  ]);
  const [bidAmount, setBidAmount] = useState(0);
  const [instantBuyPrice, setInstantBuyPrice] = useState(0);
  const [auctionTime, setAuctionTime] = useState(1); // hours
  const [selected, setSelected] = useState<string>('');
  const [message, setMessage] = useState('');

  const placeBid = (prop: Bid) => {
    if (!player || bidAmount <= prop.currentBid) {
      setMessage('Bid must be higher than current!');
      return;
    }
    if (player.cash < bidAmount) {
      setMessage('Not enough cash for bid!');
      return;
    }

    const newBids = bids.map(b => 
      b.propertyId === prop.propertyId 
        ? { ...b, currentBid: bidAmount, bidder: player.username || 'You', timeLeft: auctionTime * 60 } 
        : b
    );
    setBids(newBids);
    const updated = { ...player, cash: player.cash - bidAmount };
    updatePlayer(updated as any);
    setMessage(`Bid of $${bidAmount} placed! Auction ends in ${auctionTime}h.`);
    setBidAmount(0);
  };

  const instantBuy = (prop: Bid) => {
    if (!player || !instantBuyPrice || player.cash < instantBuyPrice) {
      setMessage('Invalid instant buy price or not enough cash.');
      return;
    }

    // Instant purchase
    const updated = { ...player, cash: player.cash - instantBuyPrice };
    updatePlayer(updated as any);
    setMessage(`Instant buy successful for ${prop.name} at $${instantBuyPrice}! Property assigned.`);
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🏛️ Marketplace</h1>
      <p className="text-sm text-zinc-400 mb-6">Bid on properties released by the dev. Highest bid wins when timer runs out. Properties come with management (bank, pricing control, maintenance costs).</p>

      <div className="mb-4 flex gap-3 items-end">
        <div>
          <label className="text-xs block mb-1">Auction Duration</label>
          <select value={auctionTime} onChange={e => setAuctionTime(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 px-3 py-1 rounded text-sm">
            <option value={1}>1 Hour</option>
            <option value={2}>2 Hours</option>
            <option value={3}>3 Hours</option>
            <option value={5}>5 Hours</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4">
        {bids.map((bid, i) => (
          <div key={i} className="card p-5">
            <div className="flex justify-between mb-3">
              <div>
                <h3 className="font-bold">{bid.name}</h3>
                <p className="text-xs">Current Bid: <span className="font-mono">${bid.currentBid}</span> by {bid.bidder}</p>
                <p className="text-xs text-orange-400">Time left: {bid.timeLeft} min</p>
              </div>
            </div>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <input 
                  type="number" 
                  value={bidAmount} 
                  onChange={e => { setBidAmount(parseInt(e.target.value) || 0); setSelected(bid.propertyId); }}
                  className="w-full bg-zinc-900 border border-zinc-700 px-3 py-1 text-sm rounded"
                  placeholder="Bid amount"
                />
              </div>
              <button onClick={() => placeBid(bid)} className="px-4 py-1 bg-red-700 rounded text-sm">Place Bid</button>
            </div>

            <div className="mt-3 flex gap-2">
              <input 
                type="number" 
                value={instantBuyPrice} 
                onChange={e => setInstantBuyPrice(parseInt(e.target.value) || 0)}
                className="flex-1 bg-zinc-900 border border-zinc-700 px-3 py-1 text-sm rounded"
                placeholder="Instant Buy Price"
              />
              <button onClick={() => instantBuy(bid)} className="px-4 py-1 bg-emerald-700 rounded text-sm">Instant Buy</button>
            </div>
          </div>
        ))}
      </div>

      {message && <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">{message}</div>}

      <div className="mt-6 text-xs text-zinc-500">
        Once won, visit the property in Real Estate to manage bank, set health prices (for hospitals), pay maintenance.
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
