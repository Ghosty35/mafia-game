'use client';

import { usePlayer } from '../components/PlayerContext';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { OwnedProperty } from '@/lib/types';
import HeatManager from '../components/HeatManager';
import { useEconomy } from '@/lib/economy';
import PropertyImage from '../components/PropertyImage';

export default function SafehousePage() {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const economy = useEconomy();
  const owned: OwnedProperty[] = player?.owned_properties || [];
  const isResidential = (p: OwnedProperty) =>
    p.name && (p.name.toLowerCase().includes('house') || p.name.toLowerCase().includes('villa') || p.name.toLowerCase().includes('mansion'));
  const safehouses = owned.filter(isResidential);
  const businesses = owned.filter((p) => !isResidential(p));

  const getWelcome = (prop: OwnedProperty) => {
    const name = prop.name || 'your spot';
    if (prop.name.toLowerCase().includes('mansion')) {
      return t('safehouse_welcome_mansion', { name });
    } else if (prop.name.toLowerCase().includes('villa')) {
      return t('safehouse_welcome_villa', { name });
    }
    return t('safehouse_welcome_house', { name });
  };

  const getShedCap = (prop: OwnedProperty) => {
    const cfg = economy?.shed;
    const lvl = prop.shed_level || 1;
    let base = cfg?.base ?? 1000;
    if (cfg?.level_multiplier) {
      const lm = (cfg.level_multiplier as Record<string, number>)[String(lvl)];
      if (lm) base = lm;
    }
    const name = (prop.name || '').toLowerCase();
    if (cfg?.tier_multiplier) {
      if (name.includes('villa')) base = Math.floor(base * (cfg.tier_multiplier['villa'] ?? 1.5));
      if (name.includes('mansion')) base = Math.floor(base * (cfg.tier_multiplier['mansion'] ?? 2.5));
    } else {
      if (name.includes('villa')) base = Math.floor(base * 1.5);
      if (name.includes('mansion')) base = Math.floor(base * 2.5);
    }
    return base;
  };

  const upgradeShed = async (propId: string) => {
    if (!player) return;
    const props = player.owned_properties || [];
    const prop = props.find((p) => p.id === propId);
    if (!prop) return;
    const currentLvl = prop.shed_level || 1;
    if (currentLvl >= (economy?.shed?.max_level ?? 3)) {
      showToast(t('safehouse_shed_max'), 'error');
      return;
    }
    const cost = (economy?.shed?.upgrade_cost_per_level ?? 50000) * currentLvl;
    if (
      !confirm(
        t('safehouse_shed_confirm', { level: currentLvl + 1, cost: fm(cost) }),
      )
    )
      return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('upgrade_shed', { prop_id: propId });
    if (error) {
      showToast(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('safehouse_shed_upgrade_no_cash')
          : error.message || t('safehouse_shed_upgrade_failed'),
        'error',
      );
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(t('safehouse_shed_upgraded', { level: data?.new_level }), 'success');
  };

  // Income is accrued + collected server-side (collect_property_income):
  // the RPC computes earnings from the catalog income * elapsed time (cap
  // 24h) and moves it to cash. The client can no longer write owned_properties.
  const collectEarnings = async (propId: string) => {
    if (!player) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('collect_property_income', { prop_id: propId });
    if (error) {
      showToast(error.message || t('safehouse_earnings_save_failed'), 'error');
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    showToast(t('safehouse_earnings_result', { net: fm(data?.collected ?? 0) }), 'success');
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h1 className="text-3xl font-bold tracking-tight">🏠 {t('safehouse_title')}</h1>
        {safehouses.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              🏠 {safehouses.length}
            </span>
            <span className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              🏢 {businesses.length}
            </span>
          </div>
        )}
      </div>
      <p className="text-sm text-zinc-400 mb-5">{t('safehouse_desc')}</p>

      {/* Lay low here to shed your heat */}
      <HeatManager variant="laylow" />

      {safehouses.length === 0 && (
        <div className="card p-6 text-center text-zinc-400 text-sm">
          {t('safehouse_none')}{' '}
          <Link href="/real-estate" className="text-red-400 hover:underline">{t('safehouse_none_link')}</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {safehouses.map((prop, i) => {
          const cap = getShedCap(prop);
          const currentWeed = player?.drug_storage?.Weed || 0;
          const successKg = player?.successful_harvest_kg || 0;
          const failedKg = player?.failed_harvest_kg || 0;
          const isMansion = prop.name.toLowerCase().includes('mansion');
          const isPenthouse = prop.name.toLowerCase().includes('penthouse');
          const isYacht = prop.name.toLowerCase().includes('yacht');
          const isVilla = prop.name.toLowerCase().includes('villa');
          const isLuxury = isMansion || isPenthouse || isYacht;
          return (
            <div key={i} className="card p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <PropertyImage catalogId={prop.id} ptype={prop.ptype} name={prop.name} size={56} />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold leading-tight truncate">{getWelcome(prop)}</h2>
                  {isYacht && <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">🛥️ Yacht Perks Active</span>}
                  <p className="text-[11px] text-zinc-500">
                    {t('safehouse_purchase_date', {
                      date: prop.purchase_date ? new Date(prop.purchase_date).toLocaleDateString() : 'N/A',
                    })}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-zinc-300 mb-3">
                <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_spots_label')}</span><span className="font-mono">{prop.spots || 2}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_bank')}</span><span className="font-mono text-amber-400">{fm(prop.bank_balance || 0)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_weekly')}</span><span className="font-mono text-emerald-400">+{fm(prop.earnings_week || 0)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_debt_label')}</span><span className="font-mono text-red-400">-{fm(prop.maintenance_due || 0)}</span></div>
                <div className="flex justify-between col-span-2"><span className="text-zinc-500">{t('safehouse_autopay_label')}</span><span className="font-mono">{prop.autopay ? t('safehouse_enabled') : t('safehouse_disabled')}</span></div>
              </div>

              {isVilla && (
                <div className="mb-3 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-sm">🛡️ {t('safehouse_bodyguard_title')}</h4>
                    <span className="text-[11px] text-zinc-400">{t('safehouse_bodyguards_current', { current: prop.bodyguards || 0 })}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mb-2">{t('safehouse_raid_chance_note')}</p>
                  <button
                    onClick={async () => {
                      if (!player) return;
                      const current = prop.bodyguards || 0;
                      if (current >= 10) { showToast(t('safehouse_hire_max'), 'error'); return; }
                      const supabase = createClient();
                      const { data, error } = await supabase.rpc('hire_bodyguard', { prop_id: prop.id });
                      if (error) {
                        showToast(error.message.includes('NOT_ENOUGH_CASH') ? t('common_not_enough_cash') : error.message || t('safehouse_hire_failed'), 'error');
                        return;
                      }
                      if (refreshPlayer) await refreshPlayer();
                      router.refresh();
                      showToast(t('safehouse_hired', { num: data?.bodyguards, cost: fm(data?.cost ?? 0) }), 'success');
                    }}
                    disabled={(prop.bodyguards || 0) >= 10}
                    className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs font-semibold disabled:opacity-40"
                  >
                    {t('safehouse_hire_button')}
                  </button>
                </div>
              )}

              {isLuxury && (
                <div className="mb-3 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700">
                  <h4 className="font-bold text-sm mb-2">💰 {t('safehouse_piggy_title')}</h4>
                  <div className="flex gap-2 mb-2">
                    <input type="number" id={`piggy-deposit-${i}`} placeholder={t('common_amount')} className="bg-zinc-900 border px-2 py-1 w-24 text-xs" />
                    <button
                      onClick={async () => {
                        if (!player) return;
                        const amt = parseInt((document.getElementById(`piggy-deposit-${i}`) as HTMLInputElement)?.value || '0');
                        if (amt <= 0 || (player?.cash || 0) < amt) { showToast(t('safehouse_piggy_invalid_deposit'), 'error'); return; }
                        if (!confirm(t('safehouse_piggy_confirm_deposit', { amount: fm(amt) }))) return;
                        const supabase = createClient();
                        const { error } = await supabase.rpc('piggy_deposit', { prop_id: prop.id, amount: amt });
                        if (error) { showToast(error.message.includes('NOT_ENOUGH_CASH') ? t('common_not_enough_cash') : error.message || t('safehouse_piggy_deposit_failed'), 'error'); return; }
                        if (refreshPlayer) await refreshPlayer();
                        router.refresh();
                        showToast(t('safehouse_piggy_deposited', { amount: fm(amt) }), 'success');
                      }}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-semibold"
                    >
                      {t('safehouse_piggy_deposit')}
                    </button>
                  </div>
                  <div className="flex gap-2 mb-1">
                    <input type="number" id={`piggy-withdraw-${i}`} placeholder={t('common_amount')} className="bg-zinc-900 border px-2 py-1 w-24 text-xs" />
                    <button
                      onClick={async () => {
                        if (!player) return;
                        const amt = parseInt((document.getElementById(`piggy-withdraw-${i}`) as HTMLInputElement)?.value || '0');
                        if (amt <= 0 || (prop.piggy_bank || 0) < amt) { showToast(t('safehouse_piggy_invalid_withdraw'), 'error'); return; }
                        const fee = Math.floor(amt * (economy?.piggy_fee_pct ?? 0.008));
                        const net = amt - fee;
                        if (!confirm(t('safehouse_piggy_confirm_withdraw', { amount: fm(amt), fee: fm(fee), net: fm(net) }))) return;
                        const supabase = createClient();
                        const { data, error } = await supabase.rpc('piggy_withdraw', { prop_id: prop.id, amount: amt });
                        if (error) { showToast(error.message.includes('NOT_ENOUGH_IN_PIGGYBANK') ? t('safehouse_piggy_not_enough') : error.message || t('safehouse_piggy_withdraw_failed'), 'error'); return; }
                        if (refreshPlayer) await refreshPlayer();
                        router.refresh();
                        showToast(t('safehouse_piggy_withdrew', { net: fm(data?.net ?? net), fee: fm(data?.fee ?? fee) }), 'success');
                      }}
                      className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-semibold"
                    >
                      {t('safehouse_piggy_withdraw_button')}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500">{t('safehouse_piggy_note')}</p>
                </div>
              )}

              {/* Shed submenu */}
              <div className="mt-auto p-3 rounded-lg bg-zinc-950 border border-zinc-700">
                <h4 className="font-bold text-sm mb-1.5">🌿 {t('safehouse_shed_title')}</h4>
                <div className="text-xs text-zinc-300 space-y-0.5">
                  <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_shed_cap_label')}</span><span className="font-mono">{currentWeed} / {cap}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_harvest_ok')}</span><span className="font-mono text-emerald-400">{successKg} kg</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">{t('safehouse_harvest_bad')}</span><span className="font-mono text-red-400">{failedKg} kg</span></div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => upgradeShed(prop.id)} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-semibold">
                    {t('safehouse_upgrade_shed', { cost: fm((economy?.shed?.upgrade_cost_per_level ?? 50000) * (prop.shed_level || 1)) })}
                  </button>
                  <button onClick={() => collectEarnings(prop.id)} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-semibold">
                    {t('safehouse_simulate_earnings')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {businesses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">🏢 {t('safehouse_business_title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {businesses.map((prop, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center gap-3 mb-2">
                  <PropertyImage catalogId={prop.id} ptype={prop.ptype} name={prop.name} size={40} />
                  <h4 className="font-bold text-sm truncate">{prop.name}</h4>
                </div>
                <div className="text-xs text-zinc-400 space-y-0.5">
                  <div className="flex justify-between"><span className="text-zinc-500">Type</span><span className="text-zinc-300">{prop.ptype}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">City</span><span className="text-zinc-300">{prop.city}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Income</span><span className="text-emerald-400">+{fm(prop.income || 0)}/hr</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Bank</span><span className="text-amber-400">{fm(prop.bank_balance || 0)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Upkeep</span><span className="text-red-400">-{fm(prop.maintenance_due || 0)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/weed-grow" className="card p-4 hover:border-red-700 transition flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <div>
            <div className="font-bold text-sm">{t('safehouse_go_weed')}</div>
            <div className="text-[11px] text-zinc-500">{t('safehouse_shed_section_desc')}</div>
          </div>
        </Link>
        <Link href="/garage" className="card p-4 hover:border-red-700 transition flex items-center gap-3">
          <span className="text-2xl">🚗</span>
          <div>
            <div className="font-bold text-sm">{t('safehouse_open_garage')}</div>
            <div className="text-[11px] text-zinc-500">{t('safehouse_garage_section_desc')}</div>
          </div>
        </Link>
      </div>

      {/* Personalized Profile Settings */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold mb-1 flex items-center gap-2">👤 {t('safehouse_profile_title')}</h3>
        <p className="text-xs text-zinc-400 mb-3">{t('safehouse_profile_desc')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-zinc-500">{t('safehouse_avatar_label')}</label>
            <input id="profile-avatar" type="text" placeholder="https://picsum... " className="w-full bg-zinc-900 border px-2 py-1" defaultValue={player?.avatar_url || 'https://picsum.photos/id/1005/100/100'} />
          </div>
          <div>
            <label className="text-xs text-zinc-500">{t('safehouse_bio_label')}</label>
            <textarea id="profile-bio" className="w-full bg-zinc-900 border px-2 py-1" rows={2} defaultValue={player?.bio || 'The streets made me...'} />
          </div>
        </div>
        <button
          onClick={async () => {
            if (!player) return;
            const avatar = (document.getElementById('profile-avatar') as HTMLInputElement)?.value || '';
            const bio = (document.getElementById('profile-bio') as HTMLTextAreaElement)?.value || '';
            const supabase = createClient();
            const { error } = await supabase.rpc('update_my_state', { patch: { avatar_url: avatar, bio } });
            if (error) { showToast(error.message || t('safehouse_profile_save_failed'), 'error'); return; }
            if (refreshPlayer) await refreshPlayer();
            router.refresh();
            showToast(t('safehouse_profile_saved'), 'success');
          }}
          className="mt-3 px-4 py-1 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold"
        >
          {t('safehouse_save_profile')}
        </button>
      </div>

      {/* Post Office - Bills, Debts, Taxes */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold mb-1 flex items-center gap-2">📮 {t('safehouse_post_title')}</h3>
        <p className="text-xs text-zinc-400 mb-3">{t('safehouse_post_desc')}</p>
        <div className="text-sm space-y-1">
          <div className="flex justify-between"><span className="text-zinc-400">{t('safehouse_open_bills_label')}</span><span className="font-mono text-red-400">{fm(owned.reduce((sum, p) => sum + (p.maintenance_due || 0), 0))}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">{t('safehouse_weekly_tax_label')}</span><span className="font-mono text-amber-400">{fm(Math.floor(owned.reduce((sum, p) => sum + (p.earnings_week || 0), 0) * 0.2))}</span></div>
        </div>
        <button
          onClick={async () => {
            if (!player) return;
            const props = (player.owned_properties || []).filter((p) => (p.maintenance_due || 0) > 0);
            const total = props.reduce((sum, p) => sum + (p.maintenance_due || 0), 0);
            if (total <= 0) { showToast(t('safehouse_no_bills'), 'error'); return; }
            if (!confirm(t('safehouse_confirm_pay_bills', { total: fm(total) }))) return;
            const supabase = createClient();
            for (const p of props) {
              const { error } = await supabase.rpc('pay_property_bill', { prop_id: p.id, amount: p.maintenance_due, method: 'cash' });
              if (error) {
                showToast(error.message.includes('NOT_ENOUGH_CASH') ? t('safehouse_bills_no_cash') : error.message || t('safehouse_payment_failed'), 'error');
                break;
              }
            }
            if (refreshPlayer) await refreshPlayer();
            router.refresh();
            showToast(t('safehouse_bills_paid'), 'success');
          }}
          className="mt-3 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-semibold"
        >
          {t('safehouse_pay_all')}
        </button>
        <div className="mt-2 text-xs text-zinc-500">{t('safehouse_post_footer')}</div>
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
