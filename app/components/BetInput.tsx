'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';

const PRESETS = [100, 1000, 10000, 100000];

// Shared stake picker for the casino standalones. The server enforces the
// 100..500,000 range; this just keeps the UI honest about it.
export default function BetInput({
  bet,
  setBet,
  disabled,
  max,
}: {
  bet: number;
  setBet: (n: number) => void;
  disabled?: boolean;
  max?: number;
}) {
  const { t, fm } = useLanguage();
  const ceiling = Math.min(500000, max ?? 500000);

  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{t('cas_your_bet')}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PRESETS.filter((p) => p <= ceiling).map((p) => (
          <button
            key={p}
            onClick={() => setBet(p)}
            disabled={disabled}
            className={`px-2.5 py-1 rounded text-xs font-mono border disabled:opacity-40 ${
              bet === p
                ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300'
                : 'bg-zinc-950 border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {fm(p)}
          </button>
        ))}
      </div>
      <input
        type="number"
        value={bet}
        min={100}
        max={ceiling}
        disabled={disabled}
        onChange={(e) => setBet(Math.max(100, Math.min(ceiling, parseInt(e.target.value) || 100)))}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-50"
      />
      <p className="text-[10px] text-zinc-500 mt-1">{t('cas_bet_range', { min: fm(100), max: fm(500000) })}</p>
    </div>
  );
}
