'use client';

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  translations,
  interpolate,
  type Language,
  type TranslationKey,
  type TranslationParams,
} from './translations';
import { formatMoney, moneySymbol } from './money';

type SetLanguageOptions = {
  /** Skip writing to DB/localStorage (used when applying the saved DB preference). */
  persist?: boolean;
};

type LanguageContextType = {
  language: Language;
  setLanguage: (lang: Language, options?: SetLanguageOptions) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /** Format an amount in the player's display currency ($ for EN, € for NL). */
  fm: (amount: number | string | null | undefined) => string;
  /** The bare currency symbol for the active language. */
  currency: string;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = localStorage.getItem('game-language');
    return saved === 'en' || saved === 'nl' ? saved : 'en';
  });

  const setLanguage = (lang: Language, options?: SetLanguageOptions) => {
    setLanguageState(lang);
    if (options?.persist === false) return;
    localStorage.setItem('game-language', lang);
    // Persist per player so the choice follows them across devices.
    // Fire-and-forget: on logged-out pages (landing/login) this simply fails silently.
    const supabase = createClient();
    supabase.rpc('set_my_language', { p_language: lang }).then(
      () => {},
      () => {},
    );
  };

  const t = (key: TranslationKey, params?: TranslationParams) =>
    interpolate(translations[language][key] ?? translations.en[key], params);

  const fm = (amount: number | string | null | undefined) =>
    formatMoney(amount, language);

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, t, fm, currency: moneySymbol(language) }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used inside a <LanguageProvider>');
  }
  return context;
}
