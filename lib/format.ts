import type { Language } from './i18n/translations';

export function formatCash(amount: number, language: Language) {
  return new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

// 95 -> "1:35"
export function formatSeconds(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
