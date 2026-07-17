'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';

// VIP Store (bug-inspectie shop split): everything VIP/donator/diamond in
// one place — donator status, donator perks, family buffs, diamond boosts.
// Unlike the old shop, non-donators SEE the store (and can buy donator
// status here); only the bundle deals stay donator-exclusive.
export default function VipStorePage() {
  const { t, fm } = useLanguage();
  const { player, refreshPlayer } = usePlayer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isDonator = !!player?.is_donator;
  const diamonds = player?.diamonds ?? 0;

  const purchaseDonatorStatus = async (costDiamonds: number) => {
    if (!confirm(t('vip_confirm_donator', { cost: costDiamonds }))) return;
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    // Atomic server-side purchase: checks + deducts diamonds + grants donator
    const { error } = await supabase.rpc('purchase_donator', { cost_diamonds: costDiamonds });
    if (error) {
      if (error.message.includes('NOT_ENOUGH_DIAMONDS')) setMessage(t('vip_err_diamonds'));
      else if (error.message.includes('ALREADY_DONATOR')) setMessage(t('vip_err_already'));
      else setMessage(t('vip_err_activate'));
    } else {
      await refreshPlayer();
      setMessage(t('vip_welcome'));
    }
    setBusy(false);
  };

  const perks = [
    { icon: '📈', title: t('vip_perk_xp_title'), desc: t('vip_perk_xp_desc') },
    { icon: '💵', title: t('vip_perk_cash_title'), desc: t('vip_perk_cash_desc') },
    { icon: '🛒', title: t('vip_perk_discount_title'), desc: t('vip_perk_discount_desc') },
    { icon: '⚡', title: t('vip_perk_regen_title'), desc: t('vip_perk_regen_desc') },
  ];

  return (
    <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            👑 {t('menu_vip_store')}
            {isDonator && <span className="ml-2 text-xs px-2 py-0.5 bg-amber-500 text-black rounded-full font-bold align-middle">{t('vip_badge')}</span>}
          </h1>
          <p className="text-xs text-zinc-400">{t('vip_subtitle')}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t('vip_your_diamonds')}</div>
          <div className="font-mono text-yellow-400 font-bold tabular-nums">{diamonds.toLocaleString()} 💎</div>
        </div>
      </div>

      {message && <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm">{message}</div>}

      {/* Donator status — the flagship item, visible to everyone */}
      {!isDonator ? (
        <div className="bg-gradient-to-br from-yellow-950/60 to-zinc-900 border border-yellow-700 rounded-xl p-5">
          <div className="font-bold text-lg text-amber-300 mb-1">👑 {t('vip_donator_title')}</div>
          <p className="text-sm text-zinc-300 mb-4">{t('vip_donator_pitch')}</p>
          <div className="grid md:grid-cols-2 gap-4 items-center">
            <div className="p-4 bg-zinc-950 rounded-lg">
              <div className="font-semibold mb-1 text-sm">{t('vip_donator_item')}</div>
              <div className="text-xs text-zinc-400">{t('vip_donator_item_desc')}</div>
              <div className="mt-3 text-yellow-400 font-mono text-lg">500 💎</div>
            </div>
            <div>
              <button
                onClick={() => purchaseDonatorStatus(500)}
                disabled={busy}
                className="w-full py-3 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 rounded-xl font-bold disabled:opacity-50"
              >
                {busy ? t('vip_activating') : t('vip_become_donator')}
              </button>
              <p className="text-[10px] text-center text-zinc-500 mt-1">{t('vip_permanent_note')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/40 border border-emerald-800 rounded-xl px-4 py-3 text-sm text-emerald-300">
          ✅ {t('vip_thanks')}
        </div>
      )}

      {/* Donator perks overview */}
      <Panel title={t('vip_perks_title')} icon="✨">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {perks.map((p, i) => (
            <div key={i} className={`card p-4 ${isDonator ? 'border-amber-700/60' : ''}`}>
              <div className="text-2xl mb-1.5">{p.icon}</div>
              <div className="font-bold text-sm">{p.title}</div>
              <div className="text-xs text-zinc-400 mt-1">{p.desc}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* VIP family buffs */}
      <Panel
        title={t('vip_buffs_title')}
        icon="⚔️"
        actions={<span className="text-[10px] px-2 py-px bg-amber-900/40 text-amber-400 rounded uppercase">{t('vip_buffs_family_only')}</span>}
      >
        <p className="text-xs text-zinc-400 mb-3">{t('vip_buffs_desc')}</p>
        <FamilyBuffsShop busy={busy} setMessage={setMessage} isDonator={isDonator} />
      </Panel>

      <div className="text-[11px] text-zinc-500 text-center">
        {t('vip_footer')}{' '}
        <Link href="/shop" className="text-red-400 hover:underline">🛒 {t('nav_shop')}</Link>
      </div>
    </main>
  );
}

// Family VIP buffs: cash or diamonds convert into family power. Bundles are
// ~12% better value and stay donator-exclusive.
function FamilyBuffsShop({ busy, setMessage, isDonator }: { busy: boolean; setMessage: (m: string) => void; isDonator: boolean }) {
  const [localBusy, setLocalBusy] = useState(false);
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const supabase = createClient();

  const buffs = [
    { id: 'power100', label: t('vip_buff_p100'), desc: t('vip_buff_p100_desc'), cash: 420000, diamonds: 140, diamondsBundle: 600, bundlePower: 2400 },
    { id: 'power250', label: t('vip_buff_p250'), desc: t('vip_buff_p250_desc'), cash: 980000, diamonds: 320, diamondsBundle: 1250, bundlePower: 5200 },
    { id: 'hourly', label: t('vip_buff_hourly'), desc: t('vip_buff_hourly_desc'), cash: 650000, diamonds: 210, diamondsBundle: 820, bundlePower: 3100 },
    { id: 'war', label: t('vip_buff_war'), desc: t('vip_buff_war_desc'), cash: 1150000, diamonds: 380, diamondsBundle: 1400, bundlePower: 5800 },
  ];

  const buyBuff = async (buff: (typeof buffs)[number], useBundle: boolean, payWith: 'cash' | 'diamonds') => {
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
          if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage(t('vip_err_no_family'));
          else setMessage(t('shop_buy_failed'));
          return;
        }
        await refreshPlayer();
        setMessage(t('vip_buff_bought', { label: buff.label, power: powerGain }));
      } else {
        // Diamond path — atomic server-side: checks + deducts diamonds + adds family power
        const costD = useBundle ? buff.diamondsBundle : buff.diamonds;
        const powerGain = useBundle ? buff.bundlePower : Math.floor(buff.diamonds * 1.8);
        const { error } = await supabase.rpc('buy_family_buff_diamonds', {
          cost_diamonds: costD,
          power_gain: powerGain,
        });
        if (error) {
          if (error.message.includes('NOT_ENOUGH_DIAMONDS')) setMessage(t('vip_err_diamonds'));
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage(t('vip_err_no_family'));
          else setMessage(t('shop_buy_failed'));
          return;
        }
        await refreshPlayer();
        setMessage(t('vip_buff_bought', { label: buff.label, power: powerGain }));
      }
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {buffs.map((b) => (
        <div key={b.id} className="card p-4 border border-amber-900/40">
          <div className="font-bold mb-0.5 text-sm">{b.label}</div>
          <div className="text-xs text-zinc-400 mb-3">{b.desc}</div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={localBusy || busy}
              onClick={() => buyBuff(b, false, 'cash')}
              className="flex-1 text-left px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs border border-zinc-700 disabled:opacity-50"
            >
              💵 {fm(b.cash)}
              <br />
              <span className="text-[10px] text-emerald-400">{t('vip_pay_cash')}</span>
            </button>
            <button
              disabled={localBusy || busy}
              onClick={() => buyBuff(b, false, 'diamonds')}
              className="flex-1 text-left px-3 py-2 rounded-lg bg-yellow-900/40 hover:bg-yellow-900/60 text-xs border border-yellow-800 disabled:opacity-50"
            >
              💎 {b.diamonds}
              <br />
              <span className="text-[10px] text-amber-300">{t('vip_pay_single')}</span>
            </button>
            <button
              disabled={localBusy || busy || !isDonator}
              onClick={() => buyBuff(b, true, 'diamonds')}
              title={!isDonator ? t('vip_bundle_locked') : undefined}
              className="flex-1 text-left px-3 py-2 rounded-lg bg-yellow-700 hover:bg-yellow-600 text-xs font-medium border border-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              💎 {b.diamondsBundle} — {t('vip_bundle')}
              <br />
              <span className="text-[10px]">+{b.bundlePower} {t('fam_stat_power').toLowerCase()} {!isDonator && `• ${t('vip_bundle_locked')}`}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
