'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Language } from '@/lib/i18n/translations';

const languages: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'nl', label: 'NL' },
];

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 border border-zinc-800 p-1">
      {languages.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => setLanguage(code)}
          className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${
            language === code
              ? 'bg-red-700 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
