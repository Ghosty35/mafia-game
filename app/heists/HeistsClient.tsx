'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { streetEventText } from '@/lib/streetEvents';
import { useRouter } from 'next/navigation';
import type { Player } from '@/lib/types';
import { useEconomy } from '@/lib/economy';

type Heist = {
  key: string;
  min_level: number;
  min_crew: number;
  min_reward: number;
  max_reward: number;
  base_success: number;
  cooldown_seconds: number;
};

// Fallback shown only until the real list loads from the `heists` table.
const DEFAULT_HEISTS: Heist[] = [
  {
    key: 'convenience_store_raid',
    min_level: 5,
    min_crew: 2,
    min_reward: 800,
    max_reward: 2200,
    base_success: 0.65,
    cooldown_seconds: 5400, // 1.5 hours
  },
  {
    key: 'armored_truck',
    min_level: 12,
    min_crew: 2,
    min_reward: 3500,
    max_reward: 8500,
    base_success: 0.42,
    cooldown_seconds: 5400,
  },
  {
    key: 'warehouse_heist',
    min_level: 10,
    min_crew: 2,
    min_reward: 1500,
    max_reward: 5000,
    base_success: 0.25,
    cooldown_seconds: 5400, // 1.5 hours
  },
];

export default function HeistsClient({ initialPlayer }: { initialPlayer: any }) {
  const { t, language, fm } = useLanguage();
  const { player: contextPlayer, updatePlayer, refreshPlayer, showToast } = usePlayer();
  const router = useRouter();
  const economy = useEconomy();
  const [player, setPlayer] = useState<Player | null>(initialPlayer || contextPlayer);
  const [heists, setHeists] = useState<Heist[]>(DEFAULT_HEISTS);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [crew, setCrew] = useState(2);
  const [bulletsUsed, setBulletsUsed] = useState(100);
  const [gearBonus, setGearBonus] = useState(0);
  // 135: the heist weapon is whatever you carry (players.equipped_weapon,
  // bought in the Armory). Boxing gloves (no heist_class) can't run a heist.
  const [armoryWeapon, setArmoryWeapon] = useState<{ key: string; label: string; power: number; heist_class: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<any[]>([]);
  const [cars, setCars] = useState<Array<{ id: string; name: string; condition: number }>>([]);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const supabase = createClient();

  // Equipped weapon from the Armory (server-authoritative catalog).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('get_armory');
      if (active && data) {
        const items = (data.items ?? []) as Array<{ key: string; label: string; power: number; heist_class: string | null }>;
        setArmoryWeapon(items.find((i) => i.key === data.equipped_weapon) ?? null);
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Load the player's cars for the getaway-driver selector.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('get_garage');
      if (active && data?.cars) {
        const list = data.cars as Array<{ id: string; name: string; condition: number }>;
        setCars(list);
        setSelectedCarId((cur) => cur || (list[0]?.id ?? ''));
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Reflect the persistent, server-authoritative gear bonus.
  useEffect(() => {
    const b = (player?.heist_gear as { bonus?: number } | null)?.bonus;
    if (b != null) setGearBonus(Number(b));
  }, [player?.heist_gear]);

  // Load cooldowns and targets
  useEffect(() => {
    if (!player) return;

    const loadData = async () => {
      const { data: cdData } = await supabase
        .from('heist_cooldowns')
        .select('heist_key, available_at')
        .eq('player_id', player.id);

      const cdMap: Record<string, number> = {};
      cdData?.forEach((cd: any) => {
        cdMap[cd.heist_key] = Date.parse(cd.available_at);
      });
      setCooldowns(cdMap);

      // Load potential PvP targets via RPC (RLS blocks reading other players directly)
      const { data: targetData } = await supabase.rpc('list_pvp_targets');
      setTargets((targetData as any[]) || []);

      // Load the real heist list (was hardcoded before — admin-added/DB heists like
      // casino_vault never showed up because this component ignored the heists table).
      const { data: heistData } = await supabase
        .from('heists')
        .select('key, min_level, min_crew, min_reward, max_reward, base_success, cooldown_seconds')
        .order('sort_order');
      if (heistData && heistData.length > 0) setHeists(heistData as Heist[]);
    };

    loadData();
  }, [player?.id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!player) return <div className="p-8">Loading...</div>;

  const inJail = player.jailed_until && new Date(player.jailed_until).getTime() > now;
  const currentHeat = player.heat || 0;

  const getHeistStatus = (heist: Heist) => {
    const cd = cooldowns[heist.key];
    if (!cd) return { ready: true, timeLeft: '' };
    if (cd <= now) return { ready: true, timeLeft: '' };
    const secs = Math.floor((cd - now) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return { ready: false, timeLeft: `${h}h ${m}m` };
  };

  const doHeist = async (heist: Heist) => {
    if (!player || inJail || player.level < heist.min_level) return;

    const status = getHeistStatus(heist);
    if (!status.ready) {
      showToast(`On cooldown for ${status.timeLeft}`, 'error');
      return;
    }

    if (!armoryWeapon?.heist_class) {
      showToast('You need a real gun equipped — buy one in the Armory first.', 'error');
      return;
    }
    if (!selectedCarId) {
      showToast('Pick a getaway car — buy one in the Garage first.', 'error');
      return;
    }

    setBusy(true);

    const { data, error } = await supabase.rpc('commit_heist', {
      heist_key: heist.key,
      crew_size: crew,
      bullets_used: bulletsUsed,
      car_id: selectedCarId,
    });

    if (error) {
      showToast(
        error.message.includes('NOT_ENOUGH_BULLETS')
          ? 'Not enough bullets for this heist. Buy some at the Metal Factory.'
          : error.message.includes('NOT_ENOUGH_STAMINA')
            ? t('error_no_stamina')
            : error.message,
        'error',
      );
    } else {
      // Bullets are validated + consumed server-side; use the authoritative row.
      const updated = data.player as Player;
      setPlayer(updated);
      updatePlayer(updated);
      setGearBonus(Number((updated.heist_gear as { bonus?: number } | null)?.bonus || 0));
      // Refresh cooldowns
      const { data: cdData } = await supabase
        .from('heist_cooldowns')
        .select('heist_key, available_at')
        .eq('player_id', updated.id);
      const cdMap: Record<string, number> = {};
      cdData?.forEach((cd: any) => { cdMap[cd.heist_key] = Date.parse(cd.available_at); });
      setCooldowns(cdMap);

      let text = data.success
        ? `✅ Heist Successful! You got ${fm(data.reward)}. Used ${data.crew_used} crew + ${gearBonus}% gear. Estimated chance was ~${data.success_chance}%.`
        : `❌ Heist Failed — the crew got caught. Used ${data.crew_used} crew + ${gearBonus}% gear. Estimated chance was ~${data.success_chance}%.`;
      // Random street event (071)
      const evText = streetEventText(data.event, t, language);
      if (evText) text += ` ${evText}`;
      showToast(text, data.success ? 'success' : 'fail');
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
    }

    setBusy(false);
  };

  // Gear is now persistent + server-authoritative (buy_heist_gear sets a
  // catalog tier on the player; commit_heist reads heist_gear.bonus).
  const buyGear = async (tier: string) => {
    if (!player) return;
    const { data, error } = await supabase.rpc('buy_heist_gear', { tier });
    if (error) {
      showToast(
        error.message.includes('NOT_ENOUGH_CASH') ? 'Not enough cash for this gear.' : error.message,
        'error',
      );
      return;
    }
    const updated = { ...player, cash: data.new_cash, heist_gear: { tier, bonus: data.bonus } } as Player;
    setPlayer(updated);
    updatePlayer(updated);
    setGearBonus(Number(data.bonus || 0));
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
  };

  const attemptHit = async (targetId: string, targetName: string) => {
    setBusy(true);

    const { data, error } = await supabase.rpc('attempt_hit', {
      target_player_id: targetId
    });

    if (error) {
      showToast(error.message, 'error');
    } else {
      const updated = data.player as Player;
      setPlayer(updated);
      updatePlayer(updated);
      if (refreshPlayer) await refreshPlayer();
      router.refresh();
      const text = data.success
        ? `Hit on ${targetName} successful! +${fm(data.stolen)} +${data.skill_gained} KillSkill`
        : `Hit failed on ${targetName}. Jailed for 5 min.`;
      showToast(text, data.success ? 'success' : 'fail');
    }
    setBusy(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">💣 Heists</h1>
        <p className="text-sm text-zinc-400">Big scores require preparation and crew. Minimum 2 members.</p>
        <div className="mt-2 text-xs text-amber-400">Your Heat: {currentHeat} • In Jail: {inJail ? 'YES' : 'No'}</div>
      </div>

      {/* Gear / Armory (Fase 5.2) */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">🛡️ Heist Armory (Buy for this run)</h2>
        <div className="flex flex-wrap gap-3">
          {(economy?.heist_gear ?? [
            { tier: 'pistol', cost: 450, bonus: 8 },
            { tier: 'kevlar', cost: 720, bonus: 12 },
            { tier: 'fullkit', cost: 1100, bonus: 18 },
          ]).map((g) => (
            <button key={g.tier} onClick={() => buyGear(g.tier)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm">
              {g.tier === 'pistol' ? 'Street Pistol' : g.tier === 'kevlar' ? 'Kevlar + Tools' : 'Full Kit'} (+{g.bonus}%) — {fm(g.cost)}
            </button>
          ))}
          <div className="text-xs self-center text-emerald-400">Current gear bonus: +{gearBonus}%</div>
        </div>
        <p className="text-[10px] text-zinc-500 mt-2">Gear is permanent and applies to your future heists (server-side).</p>
      </section>

      {/* Weapon + Getaway driver (required to run a heist) */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">🔫 Your weapon (equipped in the Armory)</h2>
        {armoryWeapon?.heist_class ? (
          <p className="text-sm">
            <span className="font-semibold text-emerald-400">{armoryWeapon.label}</span>{' '}
            <span className="text-xs text-zinc-400">
              (+{Math.min(20, Math.round((armoryWeapon.power / 8) * 10) / 10)}% heist bonus)
            </span>
          </p>
        ) : (
          <p className="text-xs text-amber-400">
            {armoryWeapon
              ? <>Your {armoryWeapon.label} won&apos;t cut it for a heist. Buy a real gun in the <Link href="/armory" className="underline">Armory</Link>.</>
              : <>No weapon equipped. Buy one in the <Link href="/armory" className="underline">Armory</Link> to run heists.</>}
          </p>
        )}

        <h2 className="font-bold mt-4 mb-2">🚗 Getaway driver</h2>
        {cars.length === 0 ? (
          <p className="text-xs text-amber-400">
            No cars available. Buy one in the <Link href="/garage" className="underline">Garage</Link> to run heists.
          </p>
        ) : (
          <select
            value={selectedCarId}
            onChange={(e) => setSelectedCarId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-sm"
          >
            {cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.condition}%)
              </option>
            ))}
          </select>
        )}
        <p className="text-[10px] text-zinc-500 mt-2">
          The getaway car adds up to +10% success and takes −8% condition wear per heist (repair it in the Garage).
        </p>
      </section>

      {/* Heist List with real cooldowns */}
      <div className="grid md:grid-cols-2 gap-4">
        {heists.map((h) => {
          const status = getHeistStatus(h);
          const canDo = player.level >= h.min_level && !inJail && status.ready;
          // Mirror the server formula (commit_heist): base + gear + crew +
          // bullets + weapon + getaway - heat penalty, capped at 90%.
          const bulletPct = Math.min(15, bulletsUsed / 10);
          const weaponPct = armoryWeapon?.heist_class ? Math.min(20, armoryWeapon.power / 8) : 0;
          const gcar = cars.find((c) => c.id === selectedCarId);
          const getawayPct = gcar ? Math.min(10, Math.floor(gcar.condition / 12)) : 0;
          const successEst = Math.round(
            Math.min(
              0.9,
              h.base_success + gearBonus / 100 + ((crew - 1) * 10) / 100 + bulletPct / 100 +
                weaponPct / 100 + getawayPct / 100 - (player.heat || 0) / 250,
            ) * 100,
          );

          return (
            <div key={h.key} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-amber-700/50 transition-all">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-semibold text-base capitalize">{h.key.replace(/_/g, ' ')}</h3>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Lvl {h.min_level}+ • Crew 2-3</span>
              </div>

              <div className="text-xs space-y-1.5 mb-4">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Reward</span>
                  <span className="font-mono text-emerald-400 font-semibold">{fm(h.min_reward)} – {fm(h.max_reward)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Est. Success</span>
                  <span className="font-mono text-amber-400 font-semibold">{successEst}%</span>
                </div>
                {!status.ready && (
                  <div className="text-orange-400 text-[10px] uppercase tracking-wider">⏱ Cooldown: {status.timeLeft}</div>
                )}
              </div>

              {/* Crew selector: 2 or 3 only (3rd optional) */}
              <div className="flex items-center gap-2 text-xs mb-3">
                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Crew:</span>
                <button
                  onClick={() => setCrew(2)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    crew === 2 ? 'bg-red-700 text-white border border-red-600' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  2
                </button>
                <button
                  onClick={() => setCrew(3)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    crew === 3 ? 'bg-red-700 text-white border border-red-600' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  3 (optional)
                </button>
              </div>

              {/* Loadout summary — weapon comes from the Armory equipment */}
              <div className="text-xs text-zinc-400 mb-2">
                Loadout:{' '}
                <span className={armoryWeapon?.heist_class ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
                  {armoryWeapon?.heist_class ? armoryWeapon.label : '⚠ no weapon'}
                </span>{' '}
                · Getaway:{' '}
                <span className={selectedCarId ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
                  {cars.find((c) => c.id === selectedCarId)?.name ?? '⚠ none'}
                </span>
              </div>
              <div className="text-xs text-zinc-400 mb-4">
                <span className="text-zinc-500">Bullets:</span>{' '}
                <input type="range" min="0" max="500" value={bulletsUsed} onChange={e => setBulletsUsed(parseInt(e.target.value))} className="ml-2 w-32 accent-red-600" />
                <span className="ml-1 font-mono text-red-400 font-semibold">{bulletsUsed}</span>
              </div>

              <button
                onClick={() => doHeist(h)}
                disabled={!canDo || busy}
                className="w-full py-2.5 rounded-lg font-bold text-sm bg-red-700 hover:bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? 'Executing...' : !status.ready ? `Cooldown ${status.timeLeft}` : inJail ? 'In Jail' : 'Launch Heist 💣'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-zinc-500">
        Police (Heat) will hit harder on big heists. High heat = higher chance of jail. Use Breakout from jail or wait it out.
      </div>

      {/* Real PvP Hits System */}
      <div className="bg-zinc-900 border border-red-900/40 rounded-xl p-5">
        <h3 className="font-bold mb-2 text-sm uppercase tracking-wider text-red-400">🎯 Contract Hits (PvP)</h3>
        <p className="text-xs text-zinc-400 mb-3">
          Use your KillSkill to assassinate other players. Success steals cash + gains KillSkill. Fail = jail + heat.
        </p>

        <div className="space-y-2 max-h-64 overflow-auto">
          {targets.length === 0 && <p className="text-xs text-zinc-500">Loading targets...</p>}
          {targets.map((t) => (
            <div key={t.id} className="flex justify-between items-center bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm">
              <div>
                <span className="font-semibold text-white">{t.username}</span>
                <span className="text-[10px] text-zinc-500 ml-2 uppercase tracking-wider">Lvl {t.level} • PWR {t.power || 0}</span>
              </div>
              <button
                onClick={() => attemptHit(t.id, t.username)}
                disabled={busy || !!inJail}
                className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 border border-red-600 rounded-lg disabled:opacity-40 transition-colors"
              >
                Attempt Hit
              </button>
            </div>
          ))}
        </div>
      </div>

      <Link href="/dashboard" className="inline-block text-sm text-amber-400 hover:text-amber-300 transition-colors">← {t('common_back')}</Link>
    </div>
  );
}
