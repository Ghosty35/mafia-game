'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const STORAGE_KEY = 'hustlers_way_welcome_dismissed';

export default function WelcomeModal({ createdAt }: { createdAt?: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (dismissed) return false;
    if (!createdAt) return true;
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return ageMs < 7 * 24 * 60 * 60 * 1000;
  });

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open]);

  const verify = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center px-4"
      onClick={verify}
    >
      <div
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/60 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={verify}
          aria-label={t('common_close')}
          className="absolute top-3 right-3 z-10 flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-950/80 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 active:scale-95 transition-all"
        >
          ✕
        </button>

        <div className="p-6 sm:p-8 pb-4 overflow-y-auto">
          <h2 className="text-2xl sm:text-3xl font-bold mb-1 text-center pr-8">{t('welcome_title')}</h2>
          <p className="text-zinc-400 text-center mb-6 text-sm">{t('welcome_subtitle')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        {/* Sticky footer so the CTA is always reachable without hunting for
            it below the fold - on a short mobile viewport the 4 stacked
            cards above can exceed the visible area. */}
        <div className="shrink-0 p-4 sm:p-6 pt-3 border-t border-zinc-800/80 bg-zinc-900">
          <button
            onClick={verify}
            className="w-full bg-red-700 hover:bg-red-600 py-3 rounded-lg font-bold transition-all active:scale-[0.985]"
          >
            {t('welcome_verify')}
          </button>
        </div>
      </div>
    </div>
  );
}
