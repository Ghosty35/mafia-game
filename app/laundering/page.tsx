'use client';

import { useState } from 'react';
import LaunderingBoard from '../components/LaunderingBoard';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

const GUIDE_STEPS: Array<{ icon: string; titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  { icon: '🩸', titleKey: 'ld_guide_s1_title', bodyKey: 'ld_guide_s1_body' },
  { icon: '🧺', titleKey: 'ld_guide_s2_title', bodyKey: 'ld_guide_s2_body' },
  { icon: '🚨', titleKey: 'ld_guide_s3_title', bodyKey: 'ld_guide_s3_body' },
  { icon: '⚖️', titleKey: 'ld_guide_s4_title', bodyKey: 'ld_guide_s4_body' },
];

export default function LaunderingPage() {
  const { t } = useLanguage();
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🧼 {t('ld_title')}</h1>
          <p className="text-xs text-zinc-400">{t('ld_desc')}</p>
        </div>
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="shrink-0 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg"
        >
          📖 {t('ld_guide_button')} {guideOpen ? '▲' : '▼'}
        </button>
      </div>

      {guideOpen && (
        <div className="mb-4 card p-4 bg-zinc-900 border border-zinc-700 space-y-3">
          <h2 className="font-semibold text-sm">{t('ld_guide_title')}</h2>
          <ol className="space-y-2">
            {GUIDE_STEPS.map((s, i) => (
              <li key={s.titleKey} className="flex gap-3 text-xs">
                <span className="text-lg shrink-0">{s.icon}</span>
                <span>
                  <span className="font-semibold text-zinc-200">{i + 1}. {t(s.titleKey)}</span>
                  <br />
                  <span className="text-zinc-400">{t(s.bodyKey)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <LaunderingBoard />
    </div>
  );
}
