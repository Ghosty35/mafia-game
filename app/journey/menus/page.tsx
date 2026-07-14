'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type LabeledItem = { labelKey: TranslationKey; textKey: TranslationKey };

const leftItems: LabeledItem[] = [
  { labelKey: 'menus_left_1_label', textKey: 'menus_left_1_text' },
  { labelKey: 'menus_left_2_label', textKey: 'menus_left_2_text' },
  { labelKey: 'menus_left_3_label', textKey: 'menus_left_3_text' },
  { labelKey: 'menus_left_4_label', textKey: 'menus_left_4_text' },
];

const topItems: LabeledItem[] = [
  { labelKey: 'menus_top_1_label', textKey: 'menus_top_1_text' },
  { labelKey: 'menus_top_2_label', textKey: 'menus_top_2_text' },
  { labelKey: 'menus_top_3_label', textKey: 'menus_top_3_text' },
];

const rightItems: TranslationKey[] = [
  'menus_right_1',
  'menus_right_2',
  'menus_right_3',
  'menus_right_4',
];

const pageItems: LabeledItem[] = [
  { labelKey: 'menus_pages_1_label', textKey: 'menus_pages_1_text' },
  { labelKey: 'menus_pages_2_label', textKey: 'menus_pages_2_text' },
  { labelKey: 'menus_pages_3_label', textKey: 'menus_pages_3_text' },
  { labelKey: 'menus_pages_4_label', textKey: 'menus_pages_4_text' },
  { labelKey: 'menus_pages_5_label', textKey: 'menus_pages_5_text' },
];

export default function MenusPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">
        {t('journey_back')}
      </Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">🧭 {t('menus_title')}</h1>
      <p className="text-zinc-400 mb-6">{t('menus_desc')}</p>

      <div className="space-y-8 text-sm">
        <div>
          <h3 className="font-semibold mb-2">{t('menus_left_title')}</h3>
          <ul className="list-disc pl-5 space-y-1">
            {leftItems.map((item) => (
              <li key={item.labelKey}>
                <strong>{t(item.labelKey)}</strong>: {t(item.textKey)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">{t('menus_top_title')}</h3>
          <ul className="list-disc pl-5 space-y-1">
            {topItems.map((item) => (
              <li key={item.labelKey}>
                <strong>{t(item.labelKey)}</strong>: {t(item.textKey)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">{t('menus_right_title')}</h3>
          <ul className="list-disc pl-5 space-y-1">
            {rightItems.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">{t('menus_pages_title')}</h3>
          <ul className="list-disc pl-5 space-y-1">
            {pageItems.map((item) => (
              <li key={item.labelKey}>
                <strong>{t(item.labelKey)}</strong>: {t(item.textKey)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-8 text-xs text-zinc-500">{t('menus_footer')}</p>
    </div>
  );
}
