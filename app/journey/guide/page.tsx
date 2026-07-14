'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const systems: { titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { titleKey: 'guide_sys_crimes_title', textKey: 'guide_sys_crimes' },
  { titleKey: 'guide_sys_families_title', textKey: 'guide_sys_families' },
  { titleKey: 'guide_sys_safehouse_title', textKey: 'guide_sys_safehouse' },
  { titleKey: 'guide_sys_weed_title', textKey: 'guide_sys_weed' },
  { titleKey: 'guide_sys_banking_title', textKey: 'guide_sys_banking' },
  { titleKey: 'guide_sys_racing_title', textKey: 'guide_sys_racing' },
];

export default function PlayerGuidePage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/journey" className="text-sm text-red-400 hover:underline">
        {t('journey_back')}
      </Link>

      <h1 className="text-3xl font-bold mt-4 mb-2">📖 {t('guide_title')}</h1>
      <p className="text-zinc-400 mb-6">{t('guide_desc')}</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-3">{t('guide_start_title')}</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>{t('guide_start_1')}</li>
            <li>{t('guide_start_2')}</li>
            <li>{t('guide_start_3')}</li>
            <li>{t('guide_start_4')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">{t('guide_systems_title')}</h2>
          <div className="grid gap-4">
            {systems.map((s) => (
              <div key={s.titleKey}>
                <strong>{t(s.titleKey)}</strong>
                <br />
                {t(s.textKey)}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">{t('guide_tips_title')}</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>{t('guide_tip_1')}</li>
            <li>{t('guide_tip_2')}</li>
            <li>{t('guide_tip_3')}</li>
            <li>{t('guide_tip_4')}</li>
            <li>{t('guide_tip_5')}</li>
          </ul>
        </section>
      </div>

      <div className="mt-10 text-xs text-zinc-500">{t('guide_footer')}</div>
    </div>
  );
}
