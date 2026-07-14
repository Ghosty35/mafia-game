'use client';

import { usePlayer } from '../components/PlayerContext';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { OwnedProperty } from '@/lib/types';

export default function SafehousePage() {
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const router = useRouter();
  const owned: OwnedProperty[] = player?.owned_properties || [];
  const safehouses = owned.filter(
    (p) =>
      p.name &&
      (p.name.toLowerCase().includes('house') ||
        p.name.toLowerCase().includes('villa') ||
        p.name.toLowerCase().includes('mansion')),
  );

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
    const lvl = prop.shed_level || 1;
    let base = 1000;
    if (lvl === 2) base = 2500;
    if (lvl === 3) base = 3500;
    if (prop.name.toLowerCase().includes('villa')) base = Math.floor(base * 1.5);
    if (prop.name.toLowerCase().includes('mansion')) base = Math.floor(base * 2.5);
    return base;
  };

  const upgradeShed = async (propId: string) => {
    if (!player) return;
    const props = player.owned_properties || [];
    const prop = props.find((p) => p.id === propId);
    if (!prop) return;
    const currentLvl = prop.shed_level || 1;
    if (currentLvl >= 3) {
      alert(t('safehouse_shed_max'));
      return;
    }
    const cost = 50000 * currentLvl;
    if (
      !confirm(
        t('safehouse_shed_confirm', { level: currentLvl + 1, cost: `$${cost.toLocaleString()}` }),
      )
    )
      return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('upgrade_shed', { prop_id: propId });
    if (error) {
      alert(
        error.message.includes('NOT_ENOUGH_CASH')
          ? t('safehouse_shed_upgrade_no_cash')
          : error.message || t('safehouse_shed_upgrade_failed'),
      );
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    alert(t('safehouse_shed_upgraded', { level: data?.new_level }));
  };

  const simulateEarnings = async (propId: string) => {
    if (!player) return;
    const props = player.owned_properties || [];
    const idx = props.findIndex((p) => p.id === propId);
    if (idx === -1) return;
    const prop = { ...props[idx] };
    const income = prop.income || 50;
    const taxRate = 0.2; // 20% realistic business tax
    const earned = Math.floor(income * 24); // 24h earnings
    const tax = Math.floor(earned * taxRate);
    const net = earned - tax;
    prop.bank_balance = (prop.bank_balance || 0) + net;
    prop.earnings_week = (prop.earnings_week || 0) + earned;
    prop.last_earned = new Date().toISOString();
    // Add tax to debt or bill
    prop.maintenance_due = (prop.maintenance_due || 0) + tax;
    const newOwned = [...props];
    newOwned[idx] = prop;
    const supabase = createClient();
    const { error } = await supabase.rpc('update_my_state', {
      patch: { owned_properties: newOwned },
    });
    if (error) {
      alert(error.message || t('safehouse_earnings_save_failed'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    alert(t('safehouse_earnings_result', { net: `$${net}`, tax: `$${tax}` }));
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-3xl font-bold mb-4">🏠 {t('safehouse_title')}</h1>
      <p className="text-sm text-zinc-400 mb-6">{t('safehouse_desc')}</p>

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
                <div>{t('safehouse_bank_balance', { amount: `$${prop.bank_balance || 0}` })}</div>
                <div>{t('safehouse_debt', { amount: `$${prop.maintenance_due || 0}` })}</div>
                <div>{t('safehouse_weekly_earnings', { amount: `$${prop.earnings_week || 0}` })}</div>
              </div>
              <div>
                <div>{t('safehouse_upgrades_note')}</div>
                <div>
                  {t('safehouse_autopay', {
                    status: prop.autopay ? t('safehouse_enabled') : t('safehouse_disabled'),
                  })}
                </div>
                {isMansion && <div>{t('safehouse_piggy_line', { amount: `$${piggy}` })}</div>}
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
                      alert(t('safehouse_hire_max'));
                      return;
                    }
                    const supabase = createClient();
                    const { data, error } = await supabase.rpc('hire_bodyguard', {
                      prop_id: prop.id,
                    });
                    if (error) {
                      alert(
                        error.message.includes('NOT_ENOUGH_CASH')
                          ? t('common_not_enough_cash')
                          : error.message || t('safehouse_hire_failed'),
                      );
                      return;
                    }
                    if (refreshPlayer) await refreshPlayer();
                    router.refresh();
                    alert(
                      t('safehouse_hired', {
                        num: data?.bodyguards,
                        cost: `$${data?.cost}`,
                        chance: 30 - (data?.bodyguards || 1) * 4,
                      }),
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
                        alert(t('safehouse_piggy_invalid_deposit'));
                        return;
                      }
                      if (!confirm(t('safehouse_piggy_confirm_deposit', { amount: `$${amt}` }))) {
                        return;
                      }
                      const supabase = createClient();
                      const { error } = await supabase.rpc('piggy_deposit', {
                        prop_id: prop.id,
                        amount: amt,
                      });
                      if (error) {
                        alert(
                          error.message.includes('NOT_ENOUGH_CASH')
                            ? t('common_not_enough_cash')
                            : error.message || t('safehouse_piggy_deposit_failed'),
                        );
                        return;
                      }
                      if (refreshPlayer) await refreshPlayer();
                      router.refresh();
                      alert(t('safehouse_piggy_deposited', { amount: `$${amt}` }));
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
                        alert(t('safehouse_piggy_invalid_withdraw'));
                        return;
                      }
                      const fee = Math.floor(amt * 0.008);
                      const net = amt - fee;
                      if (
                        !confirm(
                          t('safehouse_piggy_confirm_withdraw', {
                            amount: `$${amt}`,
                            fee: `$${fee}`,
                            net: `$${net}`,
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
                        alert(
                          error.message.includes('NOT_ENOUGH_IN_PIGGYBANK')
                            ? t('safehouse_piggy_not_enough')
                            : error.message || t('safehouse_piggy_withdraw_failed'),
                        );
                        return;
                      }
                      if (refreshPlayer) await refreshPlayer();
                      router.refresh();
                      alert(t('safehouse_piggy_withdrew', { net: `$${net}`, fee: `$${fee}` }));
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
                {t('safehouse_upgrade_shed', { cost: `$${50000 * (prop.shed_level || 1)}` })}
              </button>
              <button
                onClick={() => simulateEarnings(prop.id)}
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
              alert(error.message || t('safehouse_profile_save_failed'));
              return;
            }
            if (refreshPlayer) await refreshPlayer();
            router.refresh();
            alert(t('safehouse_profile_saved'));
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
              total: `$${owned
                .reduce((sum, p) => sum + (p.maintenance_due || 0), 0)
                .toLocaleString()}`,
            })}
          </div>
          <div>
            {t('safehouse_weekly_tax', {
              amount: `$${Math.floor(
                owned.reduce((sum, p) => sum + (p.earnings_week || 0), 0) * 0.2,
              ).toLocaleString()}`,
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
                alert(t('safehouse_no_bills'));
                return;
              }
              if (
                !confirm(t('safehouse_confirm_pay_bills', { total: `$${total.toLocaleString()}` }))
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
                  alert(
                    error.message.includes('NOT_ENOUGH_CASH')
                      ? t('safehouse_bills_no_cash')
                      : error.message || t('safehouse_payment_failed'),
                  );
                  break;
                }
              }
              if (refreshPlayer) await refreshPlayer();
              router.refresh();
              alert(t('safehouse_bills_paid'));
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
