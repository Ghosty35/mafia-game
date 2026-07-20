'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const STORAGE_KEY = 'hustlers_way_welcome_dismissed';

export default function WelcomeModal() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setOpen(true);
    }
  }, []);

  const verify = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/60 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl sm:text-3xl font-bold mb-1 text-center">{t('welcome_title')}</h2>
        <p className="text-zinc-400 text-center mb-6 text-sm">{t('welcome_subtitle')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <div className="text-lg mb-1">💰</div>
            <h3 className="font-bold text-sm mb-1">{t('welcome_step_1_title')}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{t('welcome_step_1_text')}</p>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <div className="text-lg mb-1">🧭</div>
            <h3 className="font-bold text-sm mb-1">{t('welcome_step_2_title')}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{t('welcome_step_2_text')}</p>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <div className="text-lg mb-1">🏙️</div>
            <h3 className="font-bold text-sm mb-1">{t('welcome_step_3_title')}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{t('welcome_step_3_text')}</p>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <div className="text-lg mb-1">🎮</div>
            <h3 className="font-bold text-sm mb-1">{t('welcome_step_4_title')}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{t('welcome_step_4_text')}</p>
          </div>
        </div>

        <button
          onClick={verify}
          className="w-full bg-red-700 hover:bg-red-600 py-3 rounded-lg font-bold transition-all active:scale-[0.985]"
        >
          {t('welcome_verify')}
        </button>
      </div>
    </div>
  );
}
