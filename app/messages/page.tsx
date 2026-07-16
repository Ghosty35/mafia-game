'use client';

import Link from 'next/link';
import PhoneInbox from '../components/PhoneInbox';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function MessagesPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">📬 {t('messages_title')}</h1>
        <p className="text-xs text-zinc-400">{t('msg_page_desc')}</p>
      </div>
      <PhoneInbox />
      <Link href="/dashboard" className="mt-6 inline-block text-sm text-red-400">← {t('common_back')}</Link>
    </div>
  );
}
