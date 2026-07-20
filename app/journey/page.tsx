'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const sections: { href: string; icon: string; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { href: '/journey/guide', icon: '📖', titleKey: 'journey_guide_title', descKey: 'journey_guide_desc' },
  { href: '/journey/tips', icon: '💡', titleKey: 'journey_tips_title', descKey: 'journey_tips_desc' },
  { href: '/journey/menus', icon: '🧭', titleKey: 'journey_menus_title', descKey: 'journey_menus_desc' },
  { href: '/journey/roadmap', icon: '🚀', titleKey: 'journey_roadmap_title', descKey: 'journey_roadmap_desc' },
];

export default function JourneyPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-2xl lg:text-4xl font-bold mb-2">🗺️ {t('journey_title')}</h1>
      <p className="text-zinc-400 mb-6 text-sm lg:text-base">{t('journey_desc')}</p>

      <div className="grid md:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="card p-6 hover:border-red-600 transition block">
            <div className="text-2xl mb-2">{s.icon}</div>
            <h3 className="font-bold text-xl">{t(s.titleKey)}</h3>
            <p className="text-sm text-zinc-400 mt-1">{t(s.descKey)}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 text-xs text-zinc-500">{t('journey_footer')}</div>
    </div>
  );
}
