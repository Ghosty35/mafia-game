// All game text lives in lib/i18n/locales/en.json and nl.json.
// English is the base language: every key MUST exist in en.json;
// nl.json mirrors it. TypeScript derives the valid keys from en.json,
// so a typo in t('...') is a compile error.

import en from './locales/en.json';
import nl from './locales/nl.json';

export const translations = { en, nl } as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof en;

/** Values usable inside {token} placeholders, e.g. t('nav_online', { count: 42 }) */
export type TranslationParams = Record<string, string | number>;

/**
 * Interpolate {token} placeholders in a translated string.
 * Unknown tokens are left as-is so missing params are visible in QA.
 */
export function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, token) =>
    token in params ? String(params[token]) : match,
  );
}
