'use client';

import { usePlayer } from '../components/PlayerContext';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { OwnedProperty } from '@/lib/types';
import HeatManager from '../components/HeatManager';
import { useEconomy } from '@/lib/economy';

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
    showToast(t('safehouse_earnings_result', { net: fm(data?.collected ?? 0), tax: fm(0) }), 'success');
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 {t('safehouse_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('safehouse_desc')}</p>

      {/* Lay low here to shed your heat */}
      <HeatManager variant="laylow" />

      {safehouses.length === 0 && <p className="text-amber-400">{t('safehouse_none')}</p>}

      {safehouses.map((prop, i) => {
        const cap = getShedCap(prop);
        const currentWeed = player?.drug_storage?.Weed || 0;
        const successKg = player?.successful_harvest_kg || 0;
        const failedKg = player?.failed_harvest_kg || 0;
        const isMansion = prop.name.toLowerCase().includes('mansion');
        const piggy = prop.piggy_bank || 0;
        return (
          <div key={i} className="card p-6 mb-6">
            <h2 className="text-2xl font-bold mb-2">{getWelcome(prop)}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div>
                  {t('safehouse_purchase_date', {
                    date: prop.purchase_date
                      ? new Date(prop.purchase_date).toLocaleDateString()
                      : 'N/A',
                  })}
                </div>
                <div>{t('safehouse_maintenance_note')}</div>
                <div>{t('safehouse_spots', { spots: prop.spots || 2 })}</div>
                <div>{t('safehouse_bank_balance', { amount: fm(prop.bank_balance || 0) })}</div>
                <div>{t('safehouse_debt', { amount: fm(prop.maintenance_due || 0) })}</div>
                <div>{t('safehouse_weekly_earnings', { amount: fm(prop.earnings_week || 0) })}</div>
              </div>
              <div>
                <div>{t('safehouse_upgrades_note')}</div>
                <div>
                  {t('safehouse_autopay', {
                    status: prop.autopay ? t('safehouse_enabled') : t('safehouse_disabled'),
                  })}
                </div>
                {isMansion && <div>{t('safehouse_piggy_line', { amount: fm(piggy) })}</div>}
                <div className="mt-2 text-xs text-zinc-400">{t('safehouse_details_note')}</div>
              </div>
            </div>

            {prop.name.toLowerCase().includes('villa') && (
              <div className="mt-4 p-4 bg-zinc-800 rounded">
                <h4 className="font-bold">{t('safehouse_bodyguard_title')}</h4>
                <div>{t('safehouse_bodyguards_current', { current: prop.bodyguards || 0 })}</div>
                <div>{t('safehouse_raid_chance_note')}</div>
                <button
                  onClick={async () => {
                    if (!player) return;
                    const current = prop.bodyguards || 0;
                    if (current >= 10) {
                      showToast(t('safehouse_hire_max'), 'error');
                      return;
                    }
                    const supabase = createClient();
                    const { data, error } = await supabase.rpc('hire_bodyguard', {
                      prop_id: prop.id,
                    });
                    if (error) {
                      showToast(
                        error.message.includes('NOT_ENOUGH_CASH')
                          ? t('common_not_enough_cash')
                          : error.message || t('safehouse_hire_failed'),
                        'error',
                      );
                      return;
                    }
                    if (refreshPlayer) await refreshPlayer();
                    router.refresh();
                    showToast(
                      t('safehouse_hired', {
                        num: data?.bodyguards,
                        cost: fm(data?.cost ?? 0),
                        chance: 30 - (data?.bodyguards || 1) * 4,
                      }),
                      'success',
                    );
                  }}
                  className="mt-2 px-3 py-1 bg-blue-700 rounded text-sm"
                >
                  {t('safehouse_hire_button')}
                </button>
                <p className="text-[10px] text-zinc-500">{t('safehouse_bodyguard_note')}</p>
              </div>
            )}

            {isMansion && (
              <div className="mt-4 p-4 bg-zinc-800 rounded">
                <h4 className="font-bold">{t('safehouse_piggy_title')}</h4>
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    id={`piggy-deposit-${i}`}
                    placeholder={t('common_amount')}
                    className="bg-zinc-900 border px-2 py-1 w-24"
                  />
                  <button
                    onClick={async () => {
                      if (!player) return;
                      const amt = parseInt(
                        (document.getElementById(`piggy-deposit-${i}`) as HTMLInputElement)
                          ?.value || '0',
                      );
                       if (amt <= 0 || (player?.cash || 0) < amt) {
                         showToast(t('safehouse_piggy_invalid_deposit'), 'error');
                         return;
                       }
                      if (!confirm(t('safehouse_piggy_confirm_deposit', { amount: fm(amt) }))) {
                        return;
                      }
                      const supabase = createClient();
                      const { error } = await supabase.rpc('piggy_deposit', {
                        prop_id: prop.id,
                        amount: amt,
                      });
                       if (error) {
                         showToast(
                           error.message.includes('NOT_ENOUGH_CASH')
                             ? t('common_not_enough_cash')
                             : error.message || t('safehouse_piggy_deposit_failed'),
                           'error',
                         );
                         return;
                       }
                       if (refreshPlayer) await refreshPlayer();
                       router.refresh();
                       showToast(t('safehouse_piggy_deposited', { amount: fm(amt) }), 'success');
                     }}
                    className="px-3 py-1 bg-emerald-700 rounded text-sm"
                  >
                    {t('safehouse_piggy_deposit')}
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    id={`piggy-withdraw-${i}`}
                    placeholder={t('common_amount')}
                    className="bg-zinc-900 border px-2 py-1 w-24"
                  />
                  <button
                    onClick={async () => {
                      if (!player) return;
                      const amt = parseInt(
                        (document.getElementById(`piggy-withdraw-${i}`) as HTMLInputElement)
                          ?.value || '0',
                      );
                       if (amt <= 0 || (prop.piggy_bank || 0) < amt) {
                         showToast(t('safehouse_piggy_invalid_withdraw'), 'error');
                         return;
                       }
                      const fee = Math.floor(amt * (economy?.piggy_fee_pct ?? 0.008));
                      const net = amt - fee;
                      if (
                        !confirm(
                          t('safehouse_piggy_confirm_withdraw', {
                            amount: fm(amt),
                            fee: fm(fee),
                            net: fm(net),
                          }),
                        )
                      ) {
                        return;
                      }
                      const supabase = createClient();
                      const { error } = await supabase.rpc('piggy_withdraw', {
                        prop_id: prop.id,
                        amount: amt,
                      });
                      if (error) {
                        showToast(
                          error.message.includes('NOT_ENOUGH_IN_PIGGYBANK')
                            ? t('safehouse_piggy_not_enough')
                            : error.message || t('safehouse_piggy_withdraw_failed'),
                          'error',
                        );
                        return;
                      }
                      if (refreshPlayer) await refreshPlayer();
                      router.refresh();
                      showToast(t('safehouse_piggy_withdrew', { net: fm(net), fee: fm(fee) }), 'success');
                    }}
                    className="px-3 py-1 bg-red-700 rounded text-sm"
                  >
                    {t('safehouse_piggy_withdraw_button')}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">{t('safehouse_piggy_note')}</p>
              </div>
            )}

            {/* Shed Submenu - Weed Live Trackers */}
            <div className="mt-4 p-4 bg-zinc-950 rounded border border-zinc-700">
              <h4 className="font-bold mb-2">{t('safehouse_shed_title')}</h4>
              <div>{t('safehouse_shed_capacity', { current: currentWeed, cap })}</div>
              <div>{t('safehouse_harvest_success', { kg: successKg })}</div>
              <div>{t('safehouse_harvest_failed', { kg: failedKg })}</div>
              <div className="mt-2 text-xs">{t('safehouse_shed_trackers_note')}</div>
              <button
                onClick={() => upgradeShed(prop.id)}
                className="mt-2 px-3 py-1 bg-red-700 rounded text-sm"
              >
                {t('safehouse_upgrade_shed', { cost: fm((economy?.shed?.upgrade_cost_per_level ?? 50000) * (prop.shed_level || 1)) })}
              </button>
              <button
                onClick={() => collectEarnings(prop.id)}
                className="mt-2 ml-2 px-3 py-1 bg-emerald-700 rounded text-sm"
              >
                {t('safehouse_simulate_earnings')}
              </button>
            </div>

            <div className="mt-4">
              <Link href="/weed-grow" className="text-red-400 text-sm">
                {t('safehouse_link_weed')}
              </Link>{' '}
              |{' '}
              <Link href="/garage" className="text-red-400 text-sm">
                {t('safehouse_link_garage')}
              </Link>
            </div>
          </div>
        );
      })}

      {businesses.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-bold mb-4">🏢 {t('safehouse_business_title') || 'Your Businesses'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {businesses.map((prop, i) => (
              <div key={i} className="card p-5">
                <h4 className="font-bold text-sm mb-2">{prop.name}</h4>
                <div className="text-xs text-zinc-400 space-y-1">
                  <div>Type: <span className="text-zinc-300">{prop.ptype}</span></div>
                  <div>City: <span className="text-zinc-300">{prop.city}</span></div>
                  <div>Income: <span className="text-emerald-400">+{fm(prop.income || 0)}/hr</span></div>
                  <div>Bank: <span className="text-amber-400">{fm(prop.bank_balance || 0)}</span></div>
                  <div>Maintenance: <span className="text-red-400">-{fm(prop.maintenance_due || 0)}</span></div>
                </div>
                <p className="text-[10px] text-zinc-500 mt-2">{t('safehouse_business_note') || 'Business management features coming soon.'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <h3 className="font-bold mb-2">{t('safehouse_shed_section_title')}</h3>
        <p className="text-sm">{t('safehouse_shed_section_desc')}</p>
        <Link href="/weed-grow" className="text-red-400">
          {t('safehouse_go_weed')}
        </Link>
      </div>

      <div className="mt-4">
        <h3 className="font-bold mb-2">{t('safehouse_garage_section_title')}</h3>
        <p className="text-sm">{t('safehouse_garage_section_desc')}</p>
        <Link href="/garage" className="text-red-400">
          {t('safehouse_open_garage')}
        </Link>
      </div>

      {/* Personalized Submenus - Profile Settings like Bulletstar */}
      <div className="mt-8 card p-5">
        <h3 className="font-bold mb-2">{t('safehouse_profile_title')}</h3>
        <p className="text-xs text-zinc-400 mb-3">{t('safehouse_profile_desc')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label>{t('safehouse_avatar_label')}</label>
            <input
              id="profile-avatar"
              type="text"
              placeholder="https://picsum... "
              className="w-full bg-zinc-900 border px-2 py-1"
              defaultValue={player?.avatar_url || 'https://picsum.photos/id/1005/100/100'}
            />
          </div>
          <div>
            <label>{t('safehouse_bio_label')}</label>
            <textarea
              id="profile-bio"
              className="w-full bg-zinc-900 border px-2 py-1"
              rows={2}
              defaultValue={player?.bio || 'The streets made me...'}
            />
          </div>
          <div>
            <label>{t('safehouse_fav_crime')}</label>
            <input
              type="text"
              className="w-full bg-zinc-900 border px-2 py-1"
              defaultValue="Pickpocket"
            />
          </div>
          <div>
            <label>{t('safehouse_status_msg')}</label>
            <input
              type="text"
              className="w-full bg-zinc-900 border px-2 py-1"
              defaultValue="Building the empire"
            />
          </div>
        </div>
        <button
          onClick={async () => {
            if (!player) return;
            const avatar =
              (document.getElementById('profile-avatar') as HTMLInputElement)?.value || '';
            const bio =
              (document.getElementById('profile-bio') as HTMLTextAreaElement)?.value || '';
            const supabase = createClient();
            const { error } = await supabase.rpc('update_my_state', {
              patch: { avatar_url: avatar, bio },
            });
             if (error) {
               showToast(error.message || t('safehouse_profile_save_failed'), 'error');
               return;
             }
             if (refreshPlayer) await refreshPlayer();
             router.refresh();
             showToast(t('safehouse_profile_saved'), 'success');
           }}
          className="mt-3 px-4 py-1 bg-red-700 rounded text-sm"
        >
          {t('safehouse_save_profile')}
        </button>
      </div>

      {/* Post Office - Bills, Debts, Taxes, Property Info */}
      <div className="mt-8 card p-5">
        <h3 className="font-bold mb-2">{t('safehouse_post_title')}</h3>
        <p className="text-xs text-zinc-400 mb-3">{t('safehouse_post_desc')}</p>
        <div className="text-sm">
          <div>
            {t('safehouse_open_bills', {
              total: fm(owned.reduce((sum, p) => sum + (p.maintenance_due || 0), 0)),
            })}
          </div>
          <div>
            {t('safehouse_weekly_tax', {
              amount: fm(Math.floor(owned.reduce((sum, p) => sum + (p.earnings_week || 0), 0) * 0.2)),
            })}
          </div>
          <div>{t('safehouse_tax_rate_note')}</div>
          <button
            onClick={async () => {
              if (!player) return;
              const props = (player.owned_properties || []).filter(
                (p) => (p.maintenance_due || 0) > 0,
              );
              const total = props.reduce((sum, p) => sum + (p.maintenance_due || 0), 0);
              if (total <= 0) {
                showToast(t('safehouse_no_bills'), 'error');
                return;
              }
              if (
                !confirm(t('safehouse_confirm_pay_bills', { total: fm(total) }))
              )
                return;
              const supabase = createClient();
              for (const p of props) {
                const { error } = await supabase.rpc('pay_property_bill', {
                  prop_id: p.id,
                  amount: p.maintenance_due,
                  method: 'cash',
                });
                 if (error) {
                   showToast(
                     error.message.includes('NOT_ENOUGH_CASH')
                       ? t('safehouse_bills_no_cash')
                       : error.message || t('safehouse_payment_failed'),
                     'error',
                   );
                   break;
                 }
               }
               if (refreshPlayer) await refreshPlayer();
               router.refresh();
               showToast(t('safehouse_bills_paid'), 'success');
             }}
            className="mt-2 px-3 py-1 bg-emerald-700 rounded text-sm"
          >
            {t('safehouse_pay_all')}
          </button>
        </div>
        <div className="mt-2 text-xs">{t('safehouse_post_footer')}</div>
      </div>

      <Link href="/dashboard" className="mt-8 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
