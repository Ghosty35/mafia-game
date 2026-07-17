'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import TicketForm from '../components/TicketForm';
import { useTickets } from '../components/useTickets';

export const dynamic = 'force-dynamic';

// Report (081): player-to-player reports. Only you and staff ever see one —
// the reported player is never told, which is the whole point.
export default function ReportPage() {
  const { t } = useLanguage();
  const { tickets, reload } = useTickets();

  const mine = tickets.filter((x) => x.kind === 'report');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🚩 {t('rp_title')}</h1>
        <p className="text-xs text-zinc-400">{t('rp_subtitle')}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400">
        <span className="text-white font-semibold">{t('rp_private_title')}</span> {t('rp_private_text')}
      </div>

      <TicketForm kind="report" withTarget titleKey="rp_form_title" onCreated={reload} />

      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-500">{t('rp_filed_count', { count: mine.length })}</span>
        <div className="flex gap-3">
          <Link href="/tickets" className="text-red-400 hover:underline">🎫 {t('menu_tickets')}</Link>
          <Link href="/support" className="text-red-400 hover:underline">🛟 {t('menu_support')}</Link>
        </div>
      </div>
    </div>
  );
}
