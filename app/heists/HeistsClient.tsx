'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import type { Player } from '@/lib/types';

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
  const { t } = useLanguage();
  const { player: contextPlayer, updatePlayer } = usePlayer();
  const [player, setPlayer] = useState<Player | null>(initialPlayer || contextPlayer);
  const [heists, setHeists] = useState<Heist[]>(DEFAULT_HEISTS);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [crew, setCrew] = useState(2);
  const [bulletsUsed, setBulletsUsed] = useState(100);
  const [selectedWeapon, setSelectedWeapon] = useState('Pistol');
  const [gearBonus, setGearBonus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);

  const supabase = createClient();

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

  if (!player) return <div className="p-8">Loading...</div>;

  const inJail = player.jailed_until && new Date(player.jailed_until).getTime() > Date.now();
  const currentHeat = player.heat || 0;

  const getHeistStatus = (heist: Heist) => {
    const cd = cooldowns[heist.key];
    if (!cd) return { ready: true, timeLeft: '' };
    const now = Date.now();
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
      setResult({ error: `On cooldown for ${status.timeLeft}` });
      return;
    }

    setBusy(true);
    setResult(null);

    const { data, error } = await supabase.rpc('commit_heist', {
      heist_key: heist.key,
      crew_size: crew
    });

    if (error) {
      setResult({ error: error.message });
    } else {
      const updated = data.player as Player;
      // Consume bullets for heist
      const finalBullets = Math.max(0, (player.bullets || 0) - bulletsUsed);
      const withBullets = { ...updated, bullets: finalBullets };
      setPlayer(withBullets);
      updatePlayer(withBullets);
      // Refresh cooldowns
      const { data: cdData } = await supabase
        .from('heist_cooldowns')
        .select('heist_key, available_at')
        .eq('player_id', updated.id);
      const cdMap: Record<string, number> = {};
      cdData?.forEach((cd: any) => { cdMap[cd.heist_key] = Date.parse(cd.available_at); });
      setCooldowns(cdMap);

      setResult({
        success: data.success,
        reward: data.reward,
        crew: data.crew_used,
        gearBonus,
        successChance: data.success_chance,
        bulletsUsed,
      });
    }

    setBusy(false);
  };

  const buyGear = (bonus: number, cost: number) => {
    if (!player || player.cash < cost) return;
    const newPlayer = { ...player, cash: player.cash - cost };
    setPlayer(newPlayer as Player);
    setGearBonus(gearBonus + bonus);
  };

  const attemptHit = async (targetId: string, targetName: string) => {
    setBusy(true);
    setResult(null);

    const { data, error } = await supabase.rpc('attempt_hit', {
      target_player_id: targetId
    });

    if (error) {
      setResult({ error: error.message });
    } else {
      const updated = data.player as Player;
      setPlayer(updated);
      updatePlayer(updated);
      setResult({
        success: data.success,
        message: data.success 
          ? `Hit on ${targetName} successful! +$${data.stolen} +${data.skill_gained} KillSkill`
          : `Hit failed on ${targetName}. Jailed for 5 min.`,
      });
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

      {result && (
        <div className={`card p-5 border ${result.error ? 'border-red-700' : result.success ? 'border-green-700' : 'border-red-700'}`}>
          {result.error ? (
            <p className="text-red-400">{result.error}</p>
          ) : result.message ? (
            <>
              <div className="text-lg font-bold mb-1">{result.success ? '✅ Hit Successful' : '❌ Hit Failed'}</div>
              <p className="text-sm">{result.message}</p>
            </>
          ) : (
            <>
              <div className="text-lg font-bold mb-2">
                {result.success ? '✅ Heist Successful' : '❌ Heist Failed'}
              </div>
              <div className="text-sm">
                {result.success ? `You got $${result.reward.toLocaleString()}` : 'The crew got caught.'}<br />
                Used {result.crew} crew members + {result.gearBonus}% gear.<br />
                Estimated chance was ~{result.successChance}%.
              </div>
            </>
          )}
          <button onClick={() => setResult(null)} className="mt-3 text-xs underline">Close</button>
        </div>
      )}

      {/* Gear / Armory (Fase 5.2) */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">🛡️ Heist Armory (Buy for this run)</h2>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => buyGear(8, 450)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm">Street Pistol (+8%) — $450</button>
          <button onClick={() => buyGear(12, 720)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm">Kevlar + Tools (+12%) — $720</button>
          <button onClick={() => buyGear(18, 1100)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm">Full Kit (+18%) — $1,100</button>
          <div className="text-xs self-center text-emerald-400">Current gear bonus: +{gearBonus}%</div>
        </div>
        <p className="text-[10px] text-zinc-500 mt-2">Gear is temporary for this heist run (MVP). Permanent version coming.</p>
      </section>

      {/* Heist List with real cooldowns */}
      <div className="grid md:grid-cols-2 gap-4">
        {heists.map((h) => {
          const status = getHeistStatus(h);
          const canDo = player.level >= h.min_level && !inJail && status.ready;
          const weaponBonus = selectedWeapon === 'Rifle' ? 30 : selectedWeapon === 'SMG' ? 15 : 5;
          const successEst = Math.min(92, Math.round((h.base_success + gearBonus / 100 + (crew - 1) * 10 + (bulletsUsed / 20) + weaponBonus) * 100));

          return (
            <div key={h.key} className="card p-5">
              <div className="flex justify-between">
                <h3 className="font-semibold text-xl">{h.key.replace(/_/g, ' ')}</h3>
                <span className="text-xs text-zinc-500">Lvl {h.min_level}+ • Crew 2-3</span>
              </div>

              <div className="mt-2 text-sm space-y-1">
                <div>Reward: <span className="text-emerald-400">${h.min_reward.toLocaleString()} – ${h.max_reward.toLocaleString()}</span></div>
                <div>Est. Success: <span className="font-mono text-amber-400">{successEst}%</span></div>
                {!status.ready && (
                  <div className="text-orange-400 text-xs">⏱ Cooldown: {status.timeLeft}</div>
                )}
              </div>

              {/* Crew selector: 2 or 3 only (3rd optional) */}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span>Crew:</span>
                <button 
                  onClick={() => setCrew(2)} 
                  className={`px-3 py-1 rounded ${crew === 2 ? 'bg-red-700' : 'bg-zinc-800'}`}
                >
                  2
                </button>
                <button 
                  onClick={() => setCrew(3)} 
                  className={`px-3 py-1 rounded ${crew === 3 ? 'bg-red-700' : 'bg-zinc-800'}`}
                >
                  3 (optional)
                </button>
              </div>

              {/* Weapon and Bullets for heist */}
              <div className="mt-2 text-xs">
                <span>Weapon:</span>
                <select value={selectedWeapon} onChange={e => setSelectedWeapon(e.target.value)} className="ml-2 bg-zinc-800 text-xs">
                  <option>Pistol</option>
                  <option>SMG</option>
                  <option>Rifle</option>
                </select>
              </div>
              <div className="mt-1 text-xs">
                <span>Bullets (0-500, required for bonus):</span>
                <input type="range" min="0" max="500" value={bulletsUsed} onChange={e => setBulletsUsed(parseInt(e.target.value))} className="ml-2 w-32" />
                <span className="ml-1">{bulletsUsed}</span>
              </div>

              <button
                onClick={() => doHeist(h)}
                disabled={!canDo || busy}
                className="mt-4 w-full py-2.5 rounded-lg font-bold bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Executing...' : !status.ready ? `Cooldown ${status.timeLeft}` : inJail ? 'In Jail' : 'Launch Heist'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-zinc-500">
        Police (Heat) will hit harder on big heists. High heat = higher chance of jail. Use Breakout from jail or wait it out.
      </div>

      {/* Real PvP Hits System */}
      <div className="mt-8 card p-5 border border-purple-900/50">
        <h3 className="font-semibold mb-2">🎯 Contract Hits (PvP)</h3>
        <p className="text-xs text-zinc-400 mb-3">
          Use your KillSkill to assassinate other players. Success steals cash + gains KillSkill. Fail = jail + heat.
        </p>

        <div className="space-y-2 max-h-64 overflow-auto">
          {targets.length === 0 && <p className="text-xs text-zinc-500">Loading targets...</p>}
          {targets.map((t) => (
            <div key={t.id} className="flex justify-between items-center bg-zinc-950 p-2 rounded text-sm">
              <div>
                <span className="font-medium">{t.username}</span> 
                <span className="text-xs text-zinc-500 ml-2">Lvl {t.level} • PWR {t.power || 0}</span>
              </div>
              <button
                onClick={() => attemptHit(t.id, t.username)}
                disabled={busy || !!inJail}
                className="px-3 py-1 text-xs bg-purple-700 hover:bg-purple-600 rounded disabled:opacity-50"
              >
                Attempt Hit
              </button>
            </div>
          ))}
        </div>
      </div>

      <Link href="/dashboard" className="text-sm text-red-400">← Back to Dashboard</Link>
    </div>
  );
}
