'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import TicketForm from '../components/TicketForm';
import { useTickets } from '../components/useTickets';

export const dynamic = 'force-dynamic';

// Support (081): players raise issues and bugs about the game itself.
// Player-vs-player complaints go to /report instead.
export default function SupportPage() {
  const { t } = useLanguage();
  const { tickets, reload } = useTickets();

  const mine = tickets.filter((x) => x.kind !== 'report');
  const open = mine.filter((x) => x.status !== 'closed').length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🛟 {t('sp_title')}</h1>
        <p className="text-xs text-zinc-400">{t('sp_subtitle')}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400">
        <span className="text-white font-semibold">{t('tk_sla_title')}</span> {t('tk_sla_text')}
      </div>

      <TicketForm kind="support" titleKey="sp_form_title" onCreated={reload} />

      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-500">{t('sp_open_count', { count: open })}</span>
        <div className="flex gap-3">
          <Link href="/tickets" className="text-red-400 hover:underline">🎫 {t('menu_tickets')}</Link>
          <Link href="/report" className="text-red-400 hover:underline">🚩 {t('menu_report')}</Link>
        </div>
      </div>
    </div>
  );
}
