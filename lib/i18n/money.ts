import type { Language } from './translations';
import { formatCash } from '../format';

// Bare symbol for the active display currency ($ for EN, € for NL).
export function moneySymbol(language: Language): string {
  return language === 'nl' ? '€' : '$';
}

// Tolerant wrapper around formatCash for RPC payloads (strings/nulls).
export function formatMoney(
  amount: number | string | null | undefined,
  language: Language,
): string {
  const n = Math.floor(Number(amount ?? 0));
  return formatCash(Number.isFinite(n) ? n : 0, language);
}
