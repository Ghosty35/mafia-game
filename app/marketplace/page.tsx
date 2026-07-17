'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../components/Panel';

type Listing = {
  id: string;
  title: string;
  seller: string;
  is_mine: boolean;
  start_price: number;
  buy_now: number | null;
  current_bid: number | null;
  high_bidder: string | null;
  im_high: boolean;
  ends_at: string;
  bid_count: number;
  min_next: number;
  condition: number;
  tuned: boolean;
  speed_bonus: number;
  value: number;
};

type Sale = { title: string; price: number; buyer: string | null; seller: string; settled_at: string };
type Board = { me: string; my_cash: number; live: Listing[]; recent: Sale[] };
type ListableCar = { id: string; name: string; condition: number; tuned: boolean; value: number };

export const dynamic = 'force-dynamic';

const DURATIONS = [1, 3, 6, 12, 24];

// Car marketplace (082): real auctions. Bids escrow your cash and listing
// escrows the car, so everything on this page is live money.
export default function MarketplacePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();

  const [board, setBoard] = useState<Board | null>(null);
  const [myCars, setMyCars] = useState<ListableCar[]>([]);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'browse' | 'sell'>('browse');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // sell form
  const [carId, setCarId] = useState('');
  const [startPrice, setStartPrice] = useState(10000);
  const [buyNow, setBuyNow] = useState<number | ''>('');
  const [hours, setHours] = useState(6);

  const supabase = createClient();

  const load = useCallback(async () => {
    const [b, c] = await Promise.all([supabase.rpc('get_auctions'), supabase.rpc('get_listable_cars')]);
    if (b.data) setBoard(b.data as Board);
    const cars = Array.isArray(c.data) ? (c.data as ListableCar[]) : [];
    setMyCars(cars);
    setCarId((prev) => prev || cars[0]?.id || '');
  }, []);

  useEffect(() => {
    if (player) load();
  }, [player?.id, load]);

  // Countdown + periodic settle-on-read.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 20000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load]);

  const fail = (m: string) => {
    const map: Record<string, TranslationKey> = {
      NOT_ENOUGH_CASH: 'common_not_enough_cash',
      GARAGE_FULL: 'mk_err_garage_full',
      BID_TOO_LOW: 'mk_err_bid_low',
      CANNOT_BID_OWN: 'mk_err_own',
      ALREADY_HIGH_BIDDER: 'mk_err_already_high',
      AUCTION_OVER: 'mk_err_over',
      HAS_BIDS: 'mk_err_has_bids',
      CAR_ALREADY_LISTED: 'mk_err_listed',
      TOO_MANY_LISTINGS: 'mk_err_too_many',
      BUYNOW_TOO_LOW: 'mk_err_buynow',
      PRICE_TOO_LOW: 'mk_err_price_low',
      BIDDING_PASSED_BUYNOW: 'mk_err_passed_buynow',
      IN_JAIL: 'error_in_jail',
    };
    const hit = Object.keys(map).find((k) => m.includes(k));
    setError(t(hit ? map[hit] : 'mk_err_generic'));
  };

  const run = async (fn: string, args: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    const { error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    if (err) return fail(err.message || '');
    setMessage(okMsg);
    await refreshPlayer();
    await load();
  };

  const timeLeft = (iso: string) => {
    const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  if (!player || !board) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🏛️ {t('mk_title')}</h1>
        <p className="text-xs text-zinc-400">{t('mk_subtitle')}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}
      {message && <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-lg text-sm">{message}</div>}

      {/* Tabs */}
      <div className="flex gap-1.5">
        {([['browse', '🔨', t('mk_tab_browse')], ['sell', '🏷️', t('mk_tab_sell')]] as const).map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setTab(k as 'browse' | 'sell')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
              tab === k ? 'bg-red-900/50 border-red-700 text-red-300' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'browse' ? (
        <>
          <Panel title={t('mk_live_title')} icon="🔨" bodyClassName="p-0">
            {board.live.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('mk_none_live')}</div>
            ) : (
              board.live.map((l) => {
                const ended = new Date(l.ends_at).getTime() <= now;
                const bidVal = bids[l.id] ?? l.min_next;
                return (
                  <div key={l.id} className={`border-t first:border-t-0 border-zinc-800 px-4 py-3 ${l.is_mine ? 'bg-red-950/20' : 'hover:bg-zinc-800/30'}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-11 h-11 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-xl shrink-0">🚗</div>

                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">
                          {l.title}
                          {l.tuned && <span className="ml-2 text-[10px] px-1.5 py-px bg-blue-900/60 text-blue-300 rounded uppercase">{t('gr_tuned')}</span>}
                          {l.is_mine && <span className="ml-2 text-[10px] px-1.5 py-px bg-red-900/60 text-red-300 rounded uppercase">{t('race_yours')}</span>}
                          {l.im_high && <span className="ml-2 text-[10px] px-1.5 py-px bg-emerald-900/60 text-emerald-300 rounded uppercase">{t('mk_you_lead')}</span>}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {t('market_seller')}: <span className="text-zinc-300">{l.seller}</span>
                          {' • '}{l.condition}% {l.speed_bonus > 0 && <>• +{l.speed_bonus} 🏁</>}
                          {' • '}{t('mk_book_value', { value: fm(l.value) })}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          {l.current_bid ? t('mk_current_bid') : t('mk_start_price')}
                        </div>
                        <div className="font-mono text-emerald-400 tabular-nums text-sm">
                          {fm(l.current_bid ?? l.start_price)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {l.bid_count > 0 ? t('mk_bids_by', { count: l.bid_count, bidder: l.high_bidder ?? '?' }) : t('mk_no_bids')}
                        </div>
                      </div>

                      <div className="text-right w-20">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('market_col_ends')}</div>
                        <div className={`font-mono tabular-nums text-sm ${new Date(l.ends_at).getTime() - now < 120000 ? 'text-red-400' : 'text-zinc-300'}`}>
                          {timeLeft(l.ends_at)}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {!l.is_mine ? (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <input
                          type="number"
                          value={bidVal}
                          min={l.min_next}
                          onChange={(e) => setBids((p) => ({ ...p, [l.id]: parseInt(e.target.value) || l.min_next }))}
                          className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 w-32 text-sm font-mono"
                        />
                        <button
                          onClick={() => run('auction_bid', { p_auction_id: l.id, p_amount: bidVal }, t('mk_bid_placed', { amount: fm(bidVal) }))}
                          disabled={busy || ended || l.im_high}
                          className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-40"
                        >
                          🔨 {t('market_place_bid')}
                        </button>
                        <span className="text-[10px] text-zinc-500">{t('mk_min_next', { amount: fm(l.min_next) })}</span>
                        {l.buy_now && (!l.current_bid || l.current_bid < l.buy_now) && (
                          <button
                            onClick={() => run('auction_buy_now', { p_auction_id: l.id }, t('mk_bought', { title: l.title }))}
                            disabled={busy || ended}
                            className="px-4 py-1.5 bg-emerald-800 hover:bg-emerald-700 rounded-lg text-sm font-semibold ml-auto disabled:opacity-40"
                          >
                            ⚡ {fm(l.buy_now)}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => run('auction_cancel', { p_auction_id: l.id }, t('mk_cancelled'))}
                          disabled={busy || l.bid_count > 0}
                          title={l.bid_count > 0 ? t('mk_err_has_bids') : undefined}
                          className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs disabled:opacity-40"
                        >
                          {t('common_cancel')}
                        </button>
                        {l.bid_count > 0 && <span className="text-[10px] text-zinc-500">{t('mk_err_has_bids')}</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Panel>

          {board.recent.length > 0 && (
            <Panel title={t('mk_recent_title')} icon="✅" bodyClassName="p-0">
              {board.recent.map((s, i) => (
                <div key={i} className="border-t first:border-t-0 border-zinc-800 px-4 py-2 flex items-center justify-between text-xs hover:bg-zinc-800/40">
                  <span className="text-zinc-400 truncate">
                    🚗 {s.title} — <span className="text-zinc-300">{s.buyer ?? '?'}</span> {t('mk_bought_from', { seller: s.seller })}
                  </span>
                  <span className="font-mono text-emerald-400 shrink-0">{fm(s.price)}</span>
                </div>
              ))}
            </Panel>
          )}
        </>
      ) : (
        <Panel title={t('mk_sell_title')} icon="🏷️">
          {myCars.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {t('mk_no_cars')} <Link href="/garage" className="text-red-400 hover:underline">{t('menu_garage')}</Link>
            </p>
          ) : (
            <div className="space-y-3 max-w-md">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('mk_pick_car')}</label>
                <select
                  value={carId}
                  onChange={(e) => setCarId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {myCars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.condition}% — {t('mk_book_value', { value: fm(c.value) })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('mk_start_price')}</label>
                <input
                  type="number"
                  value={startPrice}
                  min={100}
                  onChange={(e) => setStartPrice(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('mk_buy_now_optional')}</label>
                <input
                  type="number"
                  value={buyNow}
                  onChange={(e) => setBuyNow(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                  placeholder={t('mk_buy_now_placeholder')}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('mk_duration')}</label>
                <div className="flex gap-1.5">
                  {DURATIONS.map((h) => (
                    <button
                      key={h}
                      onClick={() => setHours(h)}
                      className={`flex-1 py-1.5 rounded text-xs font-semibold border ${
                        hours === h ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300' : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() =>
                  run(
                    'auction_list_car',
                    { p_car_id: carId, p_start_price: startPrice, p_buy_now: buyNow === '' ? null : buyNow, p_hours: hours },
                    t('mk_listed'),
                  )
                }
                disabled={busy || !carId}
                className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                🏷️ {t('mk_list_button')}
              </button>

              <p className="text-[11px] text-zinc-500">{t('mk_sell_note')}</p>
            </div>
          )}
        </Panel>
      )}

      <div className="text-[11px] text-zinc-500">{t('mk_footer')}</div>
    </div>
  );
}
