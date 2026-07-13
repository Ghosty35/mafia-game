'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';

const WEAPONS = [
  { name: 'Pistol', price: 200, bonus: 5, desc: 'Basic, cheap, low bonus' },
  { name: 'SMG', price: 800, bonus: 15, desc: 'Balanced, good for heists' },
  { name: 'Rifle', price: 2500, bonus: 30, desc: 'High power, expensive' },
];

export default function MurderPage() {
  const { player, updatePlayer } = usePlayer();
  const [targetName, setTargetName] = useState('');
  const [selectedWeapon, setSelectedWeapon] = useState(WEAPONS[0].name);
  const [bulletsUsed, setBulletsUsed] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [cooldown, setCooldown] = useState(0); // seconds left

  // Cooldown timer - MUST be declared before any early returns (Rules of Hooks)
  useEffect(() => {
    if (!player?.murder_cooldown) {
      setCooldown(0);
      return;
    }
    const end = new Date(player.murder_cooldown).getTime();
    const tick = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setCooldown(left);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [player?.murder_cooldown]);

  if (!player) return <div className="p-8">Loading...</div>;

  const hitmanLevel = 16;
  const murderSkillPercent = Math.min(100, Math.floor((player.murder_skill || 0) * 5));
  const isUnlocked = player.level >= hitmanLevel && murderSkillPercent >= 50;
  const canCleanHit = murderSkillPercent >= 75;

  const currentWeapon = WEAPONS.find(w => w.name === selectedWeapon)!;
  const totalCost = currentWeapon.price;

  const attemptMurder = async () => {
    if (!isUnlocked) {
      alert('Murder locked. Reach Hitman rank (level 16) and 50% KillSkill.');
      return;
    }
    if (!targetName.trim() || bulletsUsed < 10 || bulletsUsed > 500 || (player.bullets || 0) < bulletsUsed) {
      alert('Invalid input. Need at least 10 bullets and a target name.');
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const supabase = createClient();

      const { data, error } = await supabase.rpc('attempt_murder', {
        target_username: targetName,
        weapon: selectedWeapon,
        bullets_used: bulletsUsed
      });

      if (error) {
        setResult({ success: false, message: error.message });
      } else {
        updatePlayer(data.player);
        setResult(data);
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message || 'Something went wrong' });
    }

    setBusy(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🔫 Murder / PvP</h1>
      {!isUnlocked && (
        <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-sm">
          Murder locked until <strong>Hitman rank (level 16+)</strong> and <strong>50%+ KillSkill</strong>. 
          Current: Level {player.level} / {murderSkillPercent}% KillSkill
        </div>
      )}
      {isUnlocked && !canCleanHit && (
        <div className="mb-4 p-3 bg-yellow-950 border border-yellow-800 rounded text-sm">
          Below 75% KillSkill: Reduced success chance. Clean hits require 75%+.
        </div>
      )}
      <p className="text-sm text-zinc-400 mb-6">Bullets required. Clean hit = Rank + 75%+ KillSkill.</p>
      {cooldown > 0 && (
        <div className="mb-4 p-2 bg-orange-900 text-orange-200 rounded text-sm">
          Murder cooldown: {Math.floor(cooldown / 60)}m {cooldown % 60}s
        </div>
      )}

      <div className="card p-6 mb-6">
        <div className="mb-4">
          <label className="block text-sm mb-1">Target Player Name</label>
          <input 
            type="text" 
            value={targetName} 
            onChange={e => setTargetName(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-2"
            placeholder="Enter exact username"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">Weapon</label>
          <div className="flex gap-2">
            {WEAPONS.map(w => (
              <button 
                key={w.name}
                onClick={() => setSelectedWeapon(w.name)}
                className={`flex-1 p-3 rounded text-sm ${selectedWeapon === w.name ? 'bg-red-700' : 'bg-zinc-800'}`}
              >
                {w.name} (+{w.bonus}%)<br />
                <span className="text-xs">${w.price}</span>
              </button>
            ))}
          </div>
          <p className="text-xs mt-1 text-zinc-500">{currentWeapon.desc}</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">Bullets to Use (0-500)</label>
          <input 
            type="range" 
            min="0" 
            max="500" 
            value={bulletsUsed} 
            onChange={e => setBulletsUsed(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs">
            <span>0</span>
            <span className="font-mono">{bulletsUsed}</span>
            <span>500</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">Current bullets: {player.bullets || 0}</p>
        </div>

        <button 
          onClick={attemptMurder} 
          disabled={busy || !targetName.trim() || !isUnlocked || bulletsUsed < 10 || cooldown > 0}
          className="w-full py-3 bg-red-700 hover:bg-red-600 rounded font-bold disabled:opacity-50"
        >
          {busy ? 'Attempting...' : cooldown > 0 ? 'On Cooldown' : !isUnlocked ? 'Murder Locked' : `Attempt Kill with ${selectedWeapon} + ${bulletsUsed} bullets`}
        </button>
      </div>

      {result && (
        <div className={`card p-4 ${result.success ? 'border-green-700' : 'border-red-700'}`}>
          {result.message}
        </div>
      )}

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
