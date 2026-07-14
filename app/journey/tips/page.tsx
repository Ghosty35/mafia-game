'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const tipGroups: { titleKey: TranslationKey; itemKeys: TranslationKey[] }[] = [
  {
    titleKey: 'tips_crimes_title',
    itemKeys: ['tips_crimes_1', 'tips_crimes_2', 'tips_crimes_3', 'tips_crimes_4'],
  },
  { titleKey: 'tips_family_title', itemKeys: ['tips_family_1', 'tips_family_2'] },
  {
    titleKey: 'tips_safehouse_title',
    itemKeys: ['tips_safehouse_1', 'tips_safehouse_2', 'tips_safehouse_3'],
  },
  {
    titleKey: 'tips_banking_title',
    itemKeys: ['tips_banking_1', 'tips_banking_2', 'tips_banking_3'],
  },
  {
    titleKey: 'tips_general_title',
    itemKeys: ['tips_general_1', 'tips_general_2', 'tips_general_3', 'tips_general_4'],
  },
];

export default function TipsPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">
        {t('journey_back')}
      </Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">💡 {t('tips_title')}</h1>
      <p className="text-zinc-400 mb-6">{t('tips_desc')}</p>

      <div className="space-y-6">
        {tipGroups.map((group) => (
          <div key={group.titleKey} className="card p-5">
            <h3 className="font-semibold mb-2">{t(group.titleKey)}</h3>
            <ul className="text-sm space-y-1">
              {group.itemKeys.map((key) => (
                <li key={key}>• {t(key)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-zinc-500">{t('tips_footer')}</p>
    </div>
  );
}
