'use client';

import { useMemo, useState } from 'react';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';

type Category = 'cars' | 'properties' | 'items';

interface Listing {
  id: string;
  category: Category;
  icon: string;
  name: string;
  currentBid: number;
  instantPrice: number;
  bidder: string;
  seller: string;
  minutesLeft: number;
}

// Preview data — real auctions need a server-side auctions table (Phase 4
// roadmap). Bids here never touch real money; the page is a visual preview
// of the redesigned marketplace so the layout can ship ahead of the system.
const DEMO_LISTINGS: Listing[] = [
  { id: 'c1', category: 'cars', icon: '🏎️', name: 'Bugatti Veyron', currentBid: 8200000, instantPrice: 14500000, bidder: 'PlayerX', seller: 'DonSalvatore', minutesLeft: 45 },
  { id: 'c2', category: 'cars', icon: '🚗', name: 'Lowrider (tuned)', currentBid: 96000, instantPrice: 180000, bidder: 'BossY', seller: 'StreetKing', minutesLeft: 130 },
  { id: 'p1', category: 'properties', icon: '🏢', name: 'New York Train Station', currentBid: 25000, instantPrice: 90000, bidder: 'PlayerX', seller: 'CityHall', minutesLeft: 45 },
  { id: 'p2', category: 'properties', icon: '🏭', name: 'Chicago Metal Factory', currentBid: 42000, instantPrice: 150000, bidder: 'BossY', seller: 'RustBelt', minutesLeft: 120 },
  { id: 'i1', category: 'items', icon: '💎', name: 'Diamond Stash (25)', currentBid: 310000, instantPrice: 520000, bidder: 'LuckyLuke', seller: 'FenceMan', minutesLeft: 15 },
  { id: 'i2', category: 'items', icon: '🔫', name: 'Vintage Tommy Gun', currentBid: 78000, instantPrice: 140000, bidder: 'Milo', seller: 'PawnShop', minutesLeft: 200 },
];

export default function MarketplacePage() {
  const { player } = usePlayer();
  const { t, fm } = useLanguage();

  const [category, setCategory] = useState<Category>('cars');
  const [listings, setListings] = useState<Listing[]>(DEMO_LISTINGS);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');

  const visible = useMemo(() => listings.filter((l) => l.category === category), [listings, category]);

  const tabs: Array<{ key: Category; icon: string; label: string }> = [
    { key: 'cars', icon: '🚗', label: t('market_tab_cars') },
    { key: 'properties', icon: '🏠', label: t('market_tab_properties') },
    { key: 'items', icon: '📦', label: t('market_tab_items') },
  ];

  const placeBid = (l: Listing) => {
    const amount = bids[l.id] ?? 0;
    if (!player || amount <= l.currentBid) {
      setMessage(t('market_bid_too_low'));
      return;
    }
    setListings((prev) => prev.map((x) => (x.id === l.id ? { ...x, currentBid: amount, bidder: player.username || 'You' } : x)));
    setMessage(t('market_bid_preview', { amount: fm(amount) }));
    setBids((prev) => ({ ...prev, [l.id]: 0 }));
  };

  const instantBuy = (l: Listing) => {
    setMessage(t('market_instant_preview', { name: l.name, price: fm(l.instantPrice) }));
  };

  const timeLabel = (minutes: number) =>
    minutes >= 60
      ? t('market_ends_hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
      : t('market_ends_minutes', { minutes });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          🏛️ {t('market_title')}{' '}
          <span className="text-[10px] align-middle px-2 py-0.5 bg-amber-900/50 text-amber-400 rounded uppercase tracking-wider">
            {t('market_preview_badge')}
          </span>
        </h1>
        <p className="text-xs text-zinc-400">{t('market_desc')}</p>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* Category tabs */}
      <div className="flex gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setCategory(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
              category === tab.key
                ? 'bg-red-900/50 border-red-700 text-red-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Listings */}
      <Panel title={t('market_listings_title')} icon="🔨" bodyClassName="p-0">
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('market_no_listings')}</div>
        ) : (
          visible.map((l) => {
            const pct = Math.min(100, Math.round((l.minutesLeft / 240) * 100));
            return (
              <div key={l.id} className="border-t first:border-t-0 border-zinc-800 px-4 py-3 hover:bg-zinc-800/30">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Item */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-xl shrink-0">
                      {l.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{l.name}</div>
                      <div className="text-[11px] text-zinc-500">
                        {t('market_seller')}: <span className="text-zinc-300">{l.seller}</span>
                      </div>
                    </div>
                  </div>

                  {/* Current bid */}
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('market_col_bid')}</div>
                    <div className="font-mono text-emerald-400 tabular-nums text-sm">{fm(l.currentBid)}</div>
                    <div className="text-[10px] text-zinc-500">{t('market_by', { bidder: l.bidder })}</div>
                  </div>

                  {/* Time left */}
                  <div className="w-28">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('market_col_ends')}</div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${l.minutesLeft <= 30 ? 'bg-red-600' : 'bg-amber-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{timeLabel(l.minutesLeft)}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input
                    type="number"
                    value={bids[l.id] || ''}
                    min={l.currentBid + 1}
                    onChange={(e) => setBids((prev) => ({ ...prev, [l.id]: parseInt(e.target.value) || 0 }))}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 w-36 text-sm font-mono"
                    placeholder={t('market_bid_placeholder')}
                  />
                  <button onClick={() => placeBid(l)} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
                    🔨 {t('market_place_bid')}
                  </button>
                  <button
                    onClick={() => instantBuy(l)}
                    className="px-4 py-1.5 bg-emerald-800 hover:bg-emerald-700 rounded-lg text-sm font-semibold ml-auto"
                  >
                    ⚡ {t('market_instant_buy')} — {fm(l.instantPrice)}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <div className="text-[11px] text-zinc-500">{t('market_footer')}</div>
    </div>
  );
}
