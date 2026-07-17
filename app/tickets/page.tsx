'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from '../components/Panel';
import { useTickets, ticketErrorKey, type Ticket } from '../components/useTickets';

export const dynamic = 'force-dynamic';

// Tickets (081): every support/bug/report you've filed, with staff replies.
export default function TicketsPage() {
  const { t, language } = useLanguage();
  const { tickets, loading, reload } = useTickets();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dateLocale = language === 'nl' ? 'nl-NL' : 'en-US';

  const send = async (ticketId: string) => {
    if (reply.trim().length < 1) return;
    setBusy(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.rpc('reply_ticket', { p_ticket_id: ticketId, p_body: reply });
    setBusy(false);
    if (err) {
      setError(t(ticketErrorKey(err.message || '') as TranslationKey));
      return;
    }
    setReply('');
    await reload();
  };

  const kindLabel = (k: Ticket['kind']) =>
    k === 'report' ? `🚩 ${t('tk_kind_report')}` : k === 'bug' ? `🐛 ${t('tk_kind_bug')}` : `❓ ${t('tk_kind_support')}`;

  const statusChip = (s: Ticket['status']) => {
    const tone =
      s === 'answered'
        ? 'bg-emerald-900/60 text-emerald-300'
        : s === 'closed'
          ? 'bg-zinc-800 text-zinc-500'
          : 'bg-amber-900/60 text-amber-300';
    return (
      <span className={`text-[10px] px-1.5 py-px rounded uppercase tracking-wide font-semibold ${tone}`}>
        {t(`tk_status_${s}` as TranslationKey)}
      </span>
    );
  };

  if (loading) return <div className="max-w-3xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">🎫 {t('tk_title')}</h1>
          <p className="text-xs text-zinc-400">{t('tk_subtitle')}</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/support" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg">🛟 {t('menu_support')}</Link>
          <Link href="/report" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg">🚩 {t('menu_report')}</Link>
        </div>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {tickets.length === 0 ? (
        <Panel title={t('tk_list_title')} icon="🎫">
          <p className="text-sm text-zinc-500">
            {t('tk_empty')}{' '}
            <Link href="/support" className="text-red-400 hover:underline">{t('menu_support')}</Link>
          </p>
        </Panel>
      ) : (
        tickets.map((tk) => {
          const isOpen = openId === tk.id;
          return (
            <Panel
              key={tk.id}
              title={tk.subject}
              icon="🎫"
              actions={
                <div className="flex items-center gap-2 shrink-0">
                  {statusChip(tk.status)}
                  <button
                    onClick={() => { setOpenId(isOpen ? null : tk.id); setReply(''); }}
                    className="text-[11px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded"
                  >
                    {isOpen ? t('tk_collapse') : t('tk_expand', { count: tk.replies.length })}
                  </button>
                </div>
              }
            >
              <div className="text-[11px] text-zinc-500 mb-2">
                {kindLabel(tk.kind)}
                {tk.target && <> • {t('tk_about', { name: tk.target })}</>}
                {' • '}
                {new Date(tk.created_at).toLocaleString(dateLocale)}
              </div>

              {isOpen && (
                <>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap mb-3">{tk.body}</p>

                  {tk.replies.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {tk.replies.map((r) => (
                        <div
                          key={r.id}
                          className={`px-3 py-2 rounded-lg text-sm ${
                            r.is_staff
                              ? 'bg-emerald-950/40 border border-emerald-900/60'
                              : 'bg-zinc-950 border border-zinc-800'
                          }`}
                        >
                          <div className="text-[10px] uppercase tracking-wider mb-0.5 text-zinc-500">
                            {r.is_staff ? `🛟 ${t('tk_staff')}` : r.author}
                            {' • '}
                            {new Date(r.created_at).toLocaleString(dateLocale)}
                          </div>
                          <div className="text-zinc-300 whitespace-pre-wrap">{r.body}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {tk.status !== 'closed' ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder={t('tk_reply_placeholder')}
                        maxLength={2000}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() => send(tk.id)}
                        disabled={busy || !reply.trim()}
                        className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-semibold disabled:opacity-50"
                      >
                        {t('tk_reply')}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">{t('tk_closed_note')}</p>
                  )}
                </>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
