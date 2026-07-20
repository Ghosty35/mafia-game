'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import type { TranslationKey } from '@/lib/i18n/translations';
import PageHeader from '../components/PageHeader';
import { useEconomy } from '@/lib/economy';

// Weapon/vest shop (135, Bulletstar "Wapen-power winkel" reference).
// Catalog + prices are server-authoritative via get_armory / buy_armory_item;
// this page only renders what the server says exists.
type ArmoryItem = {
  key: string;
  kind: 'weapon' | 'vest';
  label: string;
  price: number;
  power: number;
  heist_class: string | null;
  min_level: number;
  sort: number;
};

type ArmoryData = {
  items: ArmoryItem[];
  equipped_weapon: string | null;
  equipped_vest: string | null;
};

const WEAPON_ICONS: Record<string, string> = {
  boxing_gloves: '🥊',
  glock17: '🔫',
  desert_eagle: '🔫',
  ak47: '🎯',
  mp5k: '💥',
  barrett_m82: '🎯',
};

export default function ArsenalPage() {
  const { t, fm } = useLanguage();
  const { player, updatePlayer, refreshPlayer, showToast } = usePlayer();
  const router = useRouter();
  const economy = useEconomy();
  const [armory, setArmory] = useState<ArmoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const powerPacks = economy?.power_packs ?? [
    { power: 50, price: 1200, labelKey: 'armory_pack_basic' as TranslationKey },
    { power: 150, price: 3500, labelKey: 'armory_pack_street' as TranslationKey },
    { power: 400, price: 8500, labelKey: 'armory_pack_heavy' as TranslationKey },
    { power: 1000, price: 18000, labelKey: 'armory_pack_warlord' as TranslationKey },
  ];

  const loadArmory = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_armory');
    if (data) setArmory(data as ArmoryData);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadArmory();
  }, []);

  const buyItem = async (item: ArmoryItem) => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('buy_armory_item', { item_key: item.key });

    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else if (error.message.includes('LEVEL_TOO_LOW')) setMessage(t('armory_level_too_low', { level: item.min_level }));
      else if (error.message.includes('ALREADY_EQUIPPED')) setMessage(t('armory_already_equipped'));
      else if (error.message.includes('IN_JAIL')) setMessage(t('error_in_jail'));
      else setMessage(t('armory_purchase_failed'));
    } else {
      if (data?.player) updatePlayer(data.player);
      showToast(t('armory_item_bought', { label: item.label, price: fm(item.price) }), 'success');
      await loadArmory();
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    }
    setBusy(false);
  };

  const buyPower = async (power: number, price: number) => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc('buy_power', { power_amount: power, cost: price });

    if (error) {
      if (error.message.includes('NOT_ENOUGH_CASH')) setMessage(t('common_not_enough_cash'));
      else setMessage(t('armory_purchase_failed'));
    } else {
      setMessage(t('armory_bought', { power, price: fm(price) }));
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    }
    setBusy(false);
  };

  const weapons = (armory?.items ?? []).filter((i) => i.kind === 'weapon');
  const vests = (armory?.items ?? []).filter((i) => i.kind === 'vest');
  const equippedWeapon = weapons.find((w) => w.key === armory?.equipped_weapon) ?? null;
  const equippedVest = vests.find((v) => v.key === armory?.equipped_vest) ?? null;
  const gearPower = (equippedWeapon?.power ?? 0) + (equippedVest?.power ?? 0);

  const renderItem = (item: ArmoryItem, equippedKey: string | null) => {
    const isEquipped = item.key === equippedKey;
    const locked = (player?.level ?? 1) < item.min_level;
    return (
      <div
        key={item.key}
        className={`card p-4 flex flex-col ${isEquipped ? 'border border-emerald-700/60 bg-emerald-950/10' : ''}`}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="text-2xl">{item.kind === 'vest' ? '🦺' : (WEAPON_ICONS[item.key] ?? '🔫')}</div>
          {isEquipped && (
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-700 text-white rounded font-bold uppercase tracking-wide">
              {t('armory_equipped')}
            </span>
          )}
        </div>
        <h3 className="font-bold text-sm">{item.label}</h3>
        <div className="text-emerald-400 font-mono text-xs mb-1">+{item.power} {t('armory_stat_power')}</div>
        <div className="text-[11px] text-zinc-500 mb-3">
          {item.min_level > 1 && <span>{t('armory_min_level', { level: item.min_level })}</span>}
          {item.kind === 'weapon' && !item.heist_class && (
            <span className="block">{t('armory_no_heist')}</span>
          )}
        </div>
        <div className="mt-auto flex justify-between items-center gap-2">
          <span className="font-mono text-sm">{fm(item.price)}</span>
          <button
            onClick={() => buyItem(item)}
            disabled={busy || isEquipped || locked}
            className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {locked ? `🔒 ${t('armory_min_level', { level: item.min_level })}` : isEquipped ? t('armory_equipped') : t('armory_buy')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title={t('armory_title')}
        subtitle={t('armory_desc')}
        icon="🗡️"
        variant="danger"
        badge={
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="text-orange-400 font-mono font-bold">⚔️ {gearPower.toLocaleString()} {t('armory_stat_power')}</span>
          </div>
        }
      />

      {message && (
        <div className="p-3 bg-zinc-900 border border-zinc-700 rounded-lg text-sm">{message}</div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500 py-8 text-center">{t('loading')}</div>
      ) : (
        <>
          {/* Loadout Summary */}
          <div className="card p-5">
            <h2 className="text-sm font-bold mb-3 uppercase tracking-wider text-zinc-400">{t('armory_your_loadout')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('armory_your_weapon')}</div>
                <div className="font-semibold text-lg">
                  {equippedWeapon ? `${WEAPON_ICONS[equippedWeapon.key] ?? '🔫'} ${equippedWeapon.label}` : `— ${t('armory_none')}`}
                </div>
                {equippedWeapon && <div className="text-xs text-emerald-400 font-mono mt-1">+{equippedWeapon.power} {t('armory_stat_power')}</div>}
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('armory_your_vest')}</div>
                <div className="font-semibold text-lg">{equippedVest ? `🦺 ${equippedVest.label}` : `— ${t('armory_none')}`}</div>
                {equippedVest && <div className="text-xs text-emerald-400 font-mono mt-1">+{equippedVest.power} {t('armory_stat_power')}</div>}
              </div>
              <div className="bg-zinc-950 border border-orange-900/50 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('armory_gear_power')}</div>
                <div className="font-mono font-bold text-2xl text-orange-400">{gearPower.toLocaleString()}</div>
                <p className="text-[10px] text-zinc-500 mt-1">{t('armory_gear_hint')}</p>
              </div>
            </div>
          </div>

          {/* Weapons */}
          <div>
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">🔫 {t('armory_weapons_title')}</h2>
            <p className="text-xs text-zinc-500 mb-3">{t('armory_weapons_hint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {weapons.map((w) => renderItem(w, armory?.equipped_weapon ?? null))}
            </div>
          </div>

          {/* Vests */}
          <div>
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">🦺 {t('armory_vests_title')}</h2>
            <p className="text-xs text-zinc-500 mb-3">{t('armory_vests_hint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {vests.map((v) => renderItem(v, armory?.equipped_vest ?? null))}
            </div>
          </div>
        </>
      )}

      {/* Power Packs */}
      <div>
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">⚔️ {t('armory_packs_title')}</h2>
        <p className="text-xs text-zinc-500 mb-3">{t('armory_packs_hint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {powerPacks.map((pack, i) => (
            <div key={i} className="card p-4 flex flex-col bg-zinc-900 border border-zinc-800">
              <div className="text-2xl mb-2">⚔️</div>
              <h3 className="font-bold text-sm mb-1">{t(pack.labelKey as TranslationKey)}</h3>
              <div className="text-emerald-400 font-mono text-xs mb-3">
                {t('armory_power', { power: pack.power })}
              </div>
              <div className="mt-auto flex justify-between items-center">
                <span className="font-mono text-sm">{fm(pack.price)}</span>
                <button
                  onClick={() => buyPower(pack.power, pack.price)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('armory_buy')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 text-xs text-zinc-500">{t('armory_footer')}</div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">
        ← {t('common_back')}
      </Link>
    </div>
  );
}
