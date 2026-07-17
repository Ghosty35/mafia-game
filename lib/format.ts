import type { Language } from './i18n/translations';

// Display-only currency localization: same numeric value, different symbol.
// EN shows dollars, NL shows euros (no exchange rate by design).
export function formatCash(amount: number, language: Language = 'en') {
  return new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US', {
    style: 'currency',
    currency: language === 'nl' ? 'EUR' : 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

// 95 -> "1:35"
export function formatSeconds(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
