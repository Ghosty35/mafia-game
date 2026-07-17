// Random street events (071): RPCs return an optional 'event' payload
// from _roll_random_event — this maps it to a translated toast line.
import type { TranslationKey, TranslationParams } from '@/lib/i18n/translations';

export type StreetEvent = {
  key: string;
  amount?: number;
  heat_delta?: number;
} | null;

const EVENT_KEYS: Record<string, TranslationKey> = {
  found_wallet: 'ev_wallet',
  informant_tip: 'ev_tip',
  police_shakedown: 'ev_shakedown',
  mugging: 'ev_mugging',
};

export function streetEventText(
  ev: StreetEvent | undefined,
  t: (key: TranslationKey, params?: TranslationParams) => string,
  language: string,
): string | null {
  if (!ev || !ev.key || !EVENT_KEYS[ev.key]) return null;
  const fmt = new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US');
  return t(EVENT_KEYS[ev.key], { amount: `$${fmt.format(Number(ev.amount ?? 0))}` });
}
