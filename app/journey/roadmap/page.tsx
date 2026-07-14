'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const soonItems: { labelKey: TranslationKey; textKey: TranslationKey }[] = [
  { labelKey: 'roadmap_soon_1_label', textKey: 'roadmap_soon_1_text' },
  { labelKey: 'roadmap_soon_2_label', textKey: 'roadmap_soon_2_text' },
  { labelKey: 'roadmap_soon_3_label', textKey: 'roadmap_soon_3_text' },
  { labelKey: 'roadmap_soon_4_label', textKey: 'roadmap_soon_4_text' },
];

const longTermItems: TranslationKey[] = [
  'roadmap_long_1',
  'roadmap_long_2',
  'roadmap_long_3',
  'roadmap_long_4',
  'roadmap_long_5',
];

const docsItems: TranslationKey[] = ['roadmap_docs_1', 'roadmap_docs_2', 'roadmap_docs_3'];

export default function RoadmapPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">
        {t('journey_back')}
      </Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">🚀 {t('roadmap_title')}</h1>
      <p className="text-zinc-400 mb-6">{t('roadmap_desc')}</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-bold mb-3">{t('roadmap_soon_title')}</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {soonItems.map((item) => (
              <li key={item.labelKey}>
                <strong>{t(item.labelKey)}</strong>: {t(item.textKey)}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">{t('roadmap_long_title')}</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {longTermItems.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">{t('roadmap_docs_title')}</h2>
          <p className="text-sm">{t('roadmap_docs_intro')}</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
            {docsItems.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-10 p-4 bg-zinc-900 rounded text-xs text-zinc-400">{t('roadmap_footer')}</div>
    </div>
  );
}
