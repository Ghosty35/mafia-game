'use client';
import { useRouter } from 'next/navigation';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import { useEconomy } from '@/lib/economy';
import Panel from '../../components/Panel';

// VIP Store (bug-inspectie shop split): everything VIP/donator/diamond in
// one place — donator status, donator perks, family buffs, diamond boosts.
// Unlike the old shop, non-donators SEE the store (and can buy donator
// status here); only the bundle deals stay donator-exclusive.
export default function VipStorePage() {
  const { t, fm } = useLanguage();
  const router = useRouter();
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
      await router.refresh();
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
      {/* Premium Header */}
      <div className="relative bg-gradient-to-r from-amber-950/80 via-zinc-900 to-zinc-900 border border-amber-800/50 rounded-xl p-6 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.08),transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1 flex items-center gap-2">
              👑 {t('menu_vip_store')}
              {isDonator && <span className="text-xs px-2.5 py-1 bg-amber-500 text-black rounded-full font-bold align-middle shadow-[0_0_10px_rgba(245,158,11,0.3)]">{t('vip_badge')}</span>}
            </h1>
            <p className="text-xs text-zinc-400">{t('vip_subtitle')}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[3px] text-zinc-500 mb-1">{t('vip_your_diamonds')}</div>
            <div className="font-mono text-amber-400 font-bold text-xl tabular-nums flex items-center gap-1.5 justify-end">
              <span className="text-2xl">💎</span>
              {diamonds.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {message && <div className="bg-zinc-900 border border-amber-800/50 rounded-lg px-4 py-2.5 text-sm text-amber-300">{message}</div>}

      {/* Donator status — the flagship item, visible to everyone */}
      {!isDonator ? (
        <div className="bg-gradient-to-br from-amber-950/60 via-zinc-900 to-zinc-900 border border-amber-700/60 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(245,158,11,0.06),transparent_60%)]" />
          <div className="relative">
            <div className="font-bold text-lg text-amber-300 mb-1">👑 {t('vip_donator_title')}</div>
            <p className="text-sm text-zinc-300 mb-4">{t('vip_donator_pitch')}</p>
            <div className="grid md:grid-cols-2 gap-4 items-center">
              <div className="p-4 bg-zinc-950/80 rounded-lg border border-amber-900/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">👑</span>
                  <div className="font-semibold text-sm">{t('vip_donator_item')}</div>
                </div>
                <div className="text-xs text-zinc-400 mb-3">{t('vip_donator_item_desc')}</div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">💎</span>
                  <span className="text-yellow-400 font-mono text-xl font-bold">500</span>
                </div>
              </div>
              <div>
                <button
                  onClick={() => purchaseDonatorStatus(500)}
                  disabled={busy}
                  className="w-full py-3.5 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 rounded-xl font-bold text-sm tracking-wide disabled:opacity-50 shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all"
                >
                  {busy ? t('vip_activating') : t('vip_become_donator')}
                </button>
                <p className="text-[10px] text-center text-zinc-500 mt-2">{t('vip_permanent_note')}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/40 border border-emerald-800 rounded-xl px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
          <span className="text-lg">✅</span>
          {t('vip_thanks')}
        </div>
      )}

      {/* Donator perks overview */}
      <Panel title={t('vip_perks_title')} icon="✨" variant="premium">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {perks.map((p, i) => (
            <div key={i} className={`p-4 rounded-lg border ${isDonator ? 'bg-amber-950/20 border-amber-800/40' : 'bg-zinc-950 border-zinc-800'}`}>
              <div className="text-2xl mb-2">{p.icon}</div>
              <div className="font-bold text-sm mb-1">{p.title}</div>
              <div className="text-xs text-zinc-400">{p.desc}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* VIP family buffs */}
      <Panel
        title={t('vip_buffs_title')}
        icon="⚔️"
        variant="premium"
        actions={<span className="text-[10px] px-2 py-px bg-amber-900/40 text-amber-400 rounded uppercase tracking-wider">{t('vip_buffs_family_only')}</span>}
      >
        <p className="text-xs text-zinc-400 mb-3">{t('vip_buffs_desc')}</p>
        <FamilyBuffsShop busy={busy} setMessage={setMessage} isDonator={isDonator} />
      </Panel>

      <div className="text-[11px] text-zinc-500 text-center">
        {t('vip_footer')}{' '}
        <Link href="/shop" className="text-amber-400 hover:text-amber-300 transition-colors">🛒 {t('nav_shop')}</Link>
      </div>
    </main>
  );
}

// Family VIP buffs: cash or diamonds convert into family power. Bundles are
// ~12% better value and stay donator-exclusive.
function FamilyBuffsShop({ busy, setMessage, isDonator }: { busy: boolean; setMessage: (m: string) => void; isDonator: boolean }) {
  const [localBusy, setLocalBusy] = useState(false);
  const { t, fm } = useLanguage();
  const router = useRouter();
  const { refreshPlayer } = usePlayer();
  const economy = useEconomy();
  const supabase = createClient();

  const buffs = [
    { id: 'power100', label: t('vip_buff_p100'), desc: t('vip_buff_p100_desc'), cash: 420000, diamonds: 140, diamondsBundle: 600 },
    { id: 'power250', label: t('vip_buff_p250'), desc: t('vip_buff_p250_desc'), cash: 980000, diamonds: 320, diamondsBundle: 1250 },
    { id: 'hourly', label: t('vip_buff_hourly'), desc: t('vip_buff_hourly_desc'), cash: 650000, diamonds: 210, diamondsBundle: 820 },
    { id: 'war', label: t('vip_buff_war'), desc: t('vip_buff_war_desc'), cash: 1150000, diamonds: 380, diamondsBundle: 1400 },
  ];

  const buyBuff = async (buff: (typeof buffs)[number], useBundle: boolean, payWith: 'cash' | 'diamonds') => {
    setLocalBusy(true);
    try {
      if (payWith === 'cash') {
        // Server derives family power from cost_cash — power_gain is no longer
        // caller-supplied, so the amount of power cannot be inflated.
        const { data, error } = await supabase.rpc('buy_family_buff_cash', {
          cost_cash: buff.cash,
        });
        if (error) {
          if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage(t('vip_err_no_family'));
          else setMessage(t('shop_buy_failed'));
          return;
        }
        await refreshPlayer();
        await router.refresh();
        setMessage(t('vip_buff_bought', { label: buff.label, power: data?.power_gain ?? 0 }));
      } else {
        // Diamond path — server derives family power from cost_diamonds and
        // the bundle flag; power_gain is no longer caller-supplied.
        const costD = useBundle ? buff.diamondsBundle : buff.diamonds;
        const { data, error } = await supabase.rpc('buy_family_buff_diamonds', {
          cost_diamonds: costD,
          p_is_bundle: useBundle,
        });
        if (error) {
          if (error.message.includes('NOT_ENOUGH_DIAMONDS')) setMessage(t('vip_err_diamonds'));
          else if (error.message.includes('NOT_IN_FAMILY')) setMessage(t('vip_err_no_family'));
          else setMessage(t('shop_buy_failed'));
          return;
        }
        await refreshPlayer();
        await router.refresh();
        setMessage(t('vip_buff_bought', { label: buff.label, power: data?.power_gain ?? 0 }));
      }
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {buffs.map((b) => (
        <div key={b.id} className="bg-zinc-950 border border-amber-900/30 rounded-xl p-4 hover:border-amber-800/50 transition-all">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">⚔️</span>
            <div className="font-bold text-sm">{b.label}</div>
          </div>
          <div className="text-xs text-zinc-400 mb-3">{b.desc}</div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={localBusy || busy}
              onClick={() => buyBuff(b, false, 'cash')}
              className="flex-1 text-left px-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs border border-zinc-700 hover:border-zinc-600 disabled:opacity-50 transition-all"
            >
              <div className="flex items-center gap-1 mb-1">
                <span>💵</span>
                <span className="font-mono font-bold text-emerald-400">{fm(b.cash)}</span>
              </div>
              <span className="text-[10px] text-zinc-500">{t('vip_pay_cash')}</span>
            </button>
            <button
              disabled={localBusy || busy}
              onClick={() => buyBuff(b, false, 'diamonds')}
              className="flex-1 text-left px-3 py-2.5 rounded-lg bg-amber-950/40 hover:bg-amber-950/60 text-xs border border-amber-800/50 hover:border-amber-700 disabled:opacity-50 transition-all"
            >
              <div className="flex items-center gap-1 mb-1">
                <span>💎</span>
                <span className="font-mono font-bold text-amber-400">{b.diamonds}</span>
              </div>
              <span className="text-[10px] text-amber-500">{t('vip_pay_single')}</span>
            </button>
            <button
              disabled={localBusy || busy || !isDonator}
              onClick={() => buyBuff(b, true, 'diamonds')}
              title={!isDonator ? t('vip_bundle_locked') : undefined}
              className={`flex-1 text-left px-3 py-2.5 rounded-lg text-xs font-medium border disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
                isDonator
                  ? 'bg-gradient-to-br from-amber-700 to-yellow-700 hover:from-amber-600 hover:to-yellow-600 border-amber-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-500'
              }`}
            >
              <div className="flex items-center gap-1 mb-1">
                <span>💎</span>
                <span className="font-mono font-bold">{b.diamondsBundle}</span>
                <span className="text-[10px] opacity-80">• {t('vip_bundle')}</span>
              </div>
              <span className="text-[10px]">
                +{Math.floor(b.diamondsBundle * (economy?.family_buff?.diamond_bundle_rate ?? 4.0))} {t('fam_stat_power').toLowerCase()}
                {!isDonator && ` • ${t('vip_bundle_locked')}`}
              </span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
