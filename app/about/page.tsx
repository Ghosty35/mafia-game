'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function AboutPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-4xl font-black tracking-tighter mb-2">{t('about_title')}</h1>
        <p className="text-zinc-400 text-sm lg:text-base">{t('about_subtitle')}</p>
      </div>

      {/* The Intro Story */}
      <div className="card p-8 mb-8 bg-zinc-900 border border-zinc-800">
        <div className="prose prose-invert max-w-none text-zinc-200 leading-relaxed">
          <h2 className="text-2xl font-bold text-red-400 mb-4">{t('about_story_title')}</h2>

          <p className="mb-4">{t('about_p1')}</p>

          <p className="mb-4">{t('about_p2')}</p>

          <p className="mb-4">
            <strong className="text-white">{t('about_p3')}</strong>
          </p>

          <p className="mb-4">{t('about_p4')}</p>

          <div className="my-6 border-l-4 border-red-600 pl-5 italic text-zinc-300">
            {t('about_quote')}
          </div>

          <p className="mb-4">{t('about_p5')}</p>

          <p className="mb-4">{t('about_p6')}</p>

          <p className="mb-4">{t('about_p7')}</p>

          <p className="mb-6">{t('about_p8')}</p>

          <p className="text-lg font-semibold text-red-400">
            {t('about_final_1')}
            <br />
            {t('about_final_2')}
            <br />
            {t('about_final_3')}
          </p>
        </div>
      </div>

      {/* Quick facts / tone */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">{t('about_loop_title')}</div>
          <div className="text-sm text-zinc-300">{t('about_loop_text')}</div>
        </div>
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">{t('about_cities_title')}</div>
          <div className="text-sm text-zinc-300">{t('about_cities_text')}</div>
        </div>
        <div className="card p-5">
          <div className="text-red-400 text-sm font-bold mb-1">{t('about_families_title')}</div>
          <div className="text-sm text-zinc-300">{t('about_families_text')}</div>
        </div>
      </div>

      {/* How to play */}
      <div className="card p-8 mb-8 bg-zinc-900 border border-zinc-800">
        <h2 className="text-2xl font-bold text-red-400 mb-4">{t('about_play_title')}</h2>
        <ul className="space-y-2.5 text-sm text-zinc-300 list-disc pl-5">
          <li>{t('about_play_1')}</li>
          <li>{t('about_play_2')}</li>
          <li>{t('about_play_3')}</li>
          <li>{t('about_play_4')}</li>
          <li>{t('about_play_5')}</li>
          <li>{t('about_play_6')}</li>
        </ul>
      </div>

      <div className="text-center text-xs text-zinc-500 mb-4">{t('about_footer')}</div>

      <Link href="/dashboard" className="inline-block text-sm text-red-400 hover:underline">
        {t('about_back')}
      </Link>
    </div>
  );
}
