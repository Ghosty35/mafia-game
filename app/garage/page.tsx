'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePlayer } from '../components/PlayerContext';
import { useRouter } from 'next/navigation';

export default function GaragePage() {
  const { player, updatePlayer, refreshPlayer } = usePlayer();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [selectedCar, setSelectedCar] = useState<any>(null);
  const [bet, setBet] = useState(500); // racing bet state (was missing)

  if (!player) return <div className="p-8">Loading...</div>;

  const ownedProps = player.owned_properties || [];
  const hasHouse = ownedProps.some((p: any) => p.name.includes('House'));
  const hasVilla = ownedProps.some((p: any) => p.name.includes('Villa'));
  const hasMansion = ownedProps.some((p: any) => p.name.includes('Mansion'));

  let maxCars = 0;
  let garageLevel = 0;
  if (hasMansion) { maxCars = 8 + 10; garageLevel = 3; } // mansion +10
  else if (hasVilla) { maxCars = 4; garageLevel = 1; } // base villa 4, upgrade later
  else if (hasHouse) { maxCars = 2; garageLevel = 0; }

  // Demo cars tied to property
  let cars = player.cars || [];
  if (cars.length === 0 && hasHouse) {
    cars = [
      { id: 'c1', name: 'Old Sedan', condition: 70, value: 2000, tuned: false },
      { id: 'c2', name: 'Sports Car', condition: 90, value: 8000, tuned: true },
    ];
  }

  const warehouseUpgrade = () => {
    if (!hasVilla && !hasMansion) {
      setMessage('Need Villa or Mansion to upgrade Warehouse.');
      return;
    }
    const cost = 10000 * (garageLevel + 1);
    if (player.cash < cost) {
      setMessage('Not enough cash for upgrade.');
      return;
    }
    const newLevel = garageLevel + 1;
    const newMax = hasMansion ? 8 + (newLevel * 10) : newLevel * 25; // example
    const updated = { ...player, cash: player.cash - cost, garage_level: newLevel };
    updatePlayer(updated as any);
    setMessage(`Warehouse upgraded to lvl ${newLevel}! Now holds ${newMax} cars.`);
  };

  const repairCar = async (car: any) => {
    const repairCost = Math.floor((100 - car.condition) * 50);
    if (player.cash < repairCost) {
      setMessage('Not enough for repair.');
      return;
    }
    const updatedCars = cars.map((c: any) => c.id === car.id ? { ...c, condition: 100 } : c);
    const updated = { ...player, cash: player.cash - repairCost, cars: updatedCars };
    updatePlayer(updated as any);
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
    setMessage(`Car repaired for $${repairCost}. Ready to tune!`);
  };

  const tuneCar = (car: any) => {
    if (car.condition < 100) {
      setMessage('Repair to 100% first.');
      return;
    }
    const tuneCost = 1000;
    if (player.cash < tuneCost) return;
    const updatedCars = cars.map((c: any) => c.id === car.id ? { ...c, tuned: true, value: c.value + 2000 } : c);
    const updated = { ...player, cash: player.cash - tuneCost, cars: updatedCars };
    updatePlayer(updated as any);
    setMessage('Car tuned! +value, better for races/heists.');
  };

  // Tuning Parts Shop - purchase and apply for small speed bonuses
  const tuningParts = [
    { name: 'Engine Upgrade', cost: 2500, bonus: 5, desc: '+5% top speed' },
    { name: 'Turbo Kit', cost: 4000, bonus: 8, desc: '+8% acceleration' },
    { name: 'Brakes & Suspension', cost: 1500, bonus: 3, desc: '+3% handling' },
    { name: 'Bodykit', cost: 1200, bonus: 2, desc: '+2% overall' }
  ];

  const buyTuningPart = (car: any, part: any) => {
    if (player.cash < part.cost) {
      setMessage('Not enough cash for part.');
      return;
    }
    const updatedCars = cars.map((c: any) => {
      if (c.id === car.id) {
        const currentBonus = c.speed_bonus || 0;
        return { 
          ...c, 
          speed_bonus: currentBonus + part.bonus,
          value: c.value + Math.floor(part.cost * 0.5),
          mods: [...(c.mods || []), part.name]
        };
      }
      return c;
    });
    const updated = { ...player, cash: player.cash - part.cost, cars: updatedCars };
    updatePlayer(updated as any);
    setMessage(`Applied ${part.name} to ${car.name}! +${part.bonus}% speed bonus.`);
  };

  const sellCar = (car: any) => {
    const sellPrice = Math.floor(car.value * (car.condition / 100));
    const updatedCars = cars.filter((c: any) => c.id !== car.id);
    const updated = { ...player, cash: player.cash + sellPrice, cars: updatedCars };
    updatePlayer(updated as any);
    setMessage(`Sold car for $${sellPrice}.`);
  };

  const crushCar = (car: any) => {
    const bullets = 15; // small, city vary in real
    const updatedCars = cars.filter((c: any) => c.id !== car.id);
    const updated = { ...player, bullets: (player.bullets || 0) + bullets, cars: updatedCars };
    updatePlayer(updated as any);
    setMessage(`Crushed for ${bullets} bullets at Junkyard.`);
  };

  const startRace = () => {
    // Basic race with bet/pinkslip
    if (!selectedCar) {
      setMessage('Select a car first.');
      return;
    }
    const win = Math.random() > 0.5;
    let gain = 500;
    if (win) {
      const updated = { ...player, cash: player.cash + gain };
      updatePlayer(updated as any);
      setMessage(`Won race! +$${gain}`);
    } else {
      if (selectedCar.pinkslip) {
        // lose car
        const updatedCars = cars.filter((c: any) => c.id !== selectedCar.id);
        const updated = { ...player, cash: Math.max(0, player.cash - gain), cars: updatedCars };
        updatePlayer(updated as any);
        setMessage(`Lost pinkslip drag! Car gone.`);
      } else {
        const updated = { ...player, cash: Math.max(0, player.cash - gain) };
        updatePlayer(updated as any);
        setMessage(`Lost bet. -$${gain}`);
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🚗 Garage (at your House/Villa/Mansion)</h1>
      <p className="text-sm text-zinc-400 mb-6">Cars tied to your property. Max cars: {maxCars}. Upgrade Warehouse for more.</p>

      {!hasHouse && !hasVilla && !hasMansion && (
        <div className="text-red-400 mb-4">Buy a House, Villa or Mansion in Real Estate to unlock Garage!</div>
      )}

      {hasVilla || hasMansion && (
        <div className="mb-4">
          <button onClick={warehouseUpgrade} className="px-4 py-2 bg-blue-700 rounded">Upgrade Warehouse (for more car spots)</button>
          <p className="text-xs">Villa: base 4, +25/75/125 per lvl. Mansion: +10 more.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Tune Shop */}
        <div className="card p-5">
          <h3 className="font-bold">🔧 Tune Shop (after 100% repair)</h3>
          <p className="text-xs">Basic tune +value. Buy parts below for speed bonuses (engine, turbo etc). Low-mid-high-super scale planned.</p>
          {cars.filter((c: any) => c.condition === 100).map((car: any, i: number) => (
            <div key={i} className="mt-2">
              <button onClick={() => tuneCar(car)} className="text-sm bg-blue-600 px-2 py-1 rounded">Basic Tune {car.name}</button>
              <div className="mt-1 text-xs">Parts:</div>
              {tuningParts.map((part, pi) => (
                <button key={pi} onClick={() => buyTuningPart(car, part)} className="text-xs bg-emerald-700 px-2 py-0.5 rounded mr-1 mt-1">
                  {part.name} (${part.cost}) {part.desc}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Body Repair */}
        <div className="card p-5">
          <h3 className="font-bold">🛠 Body Repair Shop</h3>
          <p className="text-xs">Repair value. More damage = higher cost. Must 100% for tune.</p>
          {cars.map((car: any, i: number) => (
            <div key={i} className="mt-2 flex justify-between">
              <span>{car.name} ({car.condition}%)</span>
              <button onClick={() => repairCar(car)} className="text-sm bg-blue-600 px-2 py-1 rounded">Repair</button>
            </div>
          ))}
        </div>

        {/* Car Marketplace with Categories and Images */}
        <div className="card p-5">
          <h3 className="font-bold">🚘 Car Marketplace & Categories</h3>
          <p className="text-xs">Low end (hatchbacks), Mid (sedans like Lexus/Mercedes/Nissan), High, Super sport. Images for steal congrats.</p>
          
          {/* Low End Examples */}
          <div className="mt-2">
            <div className="font-semibold text-xs">Low End (15 examples: Civic, Corolla, Focus, etc.)</div>
            <div className="flex gap-2 mt-1">
              {['Honda Civic', 'Toyota Corolla', 'Ford Focus', 'VW Golf'].map((name, idx) => (
                <div key={idx} className="text-xs">
                  <img src={`https://picsum.photos/id/${20+idx}/80/40`} alt={name} className="rounded" />
                  {name} (base speed 85)
                </div>
              ))}
            </div>
          </div>

          {/* Mid Range */}
          <div className="mt-2">
            <div className="font-semibold text-xs">Mid Range (sedans: Lexus, Mercedes, Nissan)</div>
            <div className="flex gap-2 mt-1">
              {['Lexus IS', 'Mercedes C-Class', 'Nissan Altima'].map((name, idx) => (
                <div key={idx} className="text-xs">
                  <img src={`https://picsum.photos/id/${30+idx}/80/40`} alt={name} className="rounded" />
                  {name} (base 105)
                </div>
              ))}
            </div>
          </div>

          {cars.map((car: any, i: number) => (
            <div key={i} className="mt-2">
              <button onClick={() => sellCar(car)} className="text-sm bg-emerald-600 px-2 py-1 rounded">Sell {car.name} for ~${Math.floor(car.value * (car.condition/100))}</button>
            </div>
          ))}
        </div>

        {/* Junkyard */}
        <div className="card p-5">
          <h3 className="font-bold">🗑 Junkyard</h3>
          <p className="text-xs">Crush for small bullets (city prices vary, low - better buy at Metal Factory).</p>
          {cars.map((car: any, i: number) => (
            <div key={i} className="mt-2">
              <button onClick={() => crushCar(car)} className="text-sm bg-red-600 px-2 py-1 rounded">Crush {car.name} (+15 bullets)</button>
            </div>
          ))}
        </div>
      </div>

      {/* Racing with bet/pinkslip */}
      <div className="mt-6 card p-5">
        <h3 className="font-bold">🏁 Racing (use Garage cars)</h3>
        <p>Select car, bet or pinkslip.</p>
        <select onChange={e => setSelectedCar(cars.find((c: any) => c.id == e.target.value))} className="bg-zinc-900 p-1">
          {cars.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.condition}%)</option>)}
        </select>
        <input type="number" value={bet} onChange={e => setBet(parseInt(e.target.value))} className="ml-2 bg-zinc-900 p-1 w-20" />
        <label className="ml-2"><input type="checkbox" onChange={e => setSelectedCar({...selectedCar, pinkslip: e.target.checked})} /> Pinkslip</label>
        <button onClick={startRace} className="ml-2 px-3 py-1 bg-red-700 rounded">Race!</button>
        {message && <div className="mt-2 text-sm">{message}</div>}
      </div>

      <Link href="/dashboard" className="mt-4 inline-block text-sm text-red-400">← Back</Link>
    </div>
  );
}
