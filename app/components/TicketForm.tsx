'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';
import Panel from './Panel';
import { ticketErrorKey } from './useTickets';

// Used by /support (kind support|bug) and /report (kind report).
export default function TicketForm({
  kind,
  withTarget,
  titleKey,
  onCreated,
}: {
  kind: 'support' | 'bug' | 'report';
  withTarget?: boolean;
  titleKey: TranslationKey;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('');
  const [kindSel, setKindSel] = useState<'support' | 'bug'>(kind === 'bug' ? 'bug' : 'support');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    setOk(false);
    const supabase = createClient();
    const { error: err } = await supabase.rpc('open_ticket', {
      p_kind: kind === 'report' ? 'report' : kindSel,
      p_subject: subject,
      p_body: body,
      p_target_username: withTarget ? target : null,
    });
    setBusy(false);
    if (err) {
      setError(t(ticketErrorKey(err.message || '') as TranslationKey));
      return;
    }
    setSubject('');
    setBody('');
    setTarget('');
    setOk(true);
    onCreated();
  };

  return (
    <Panel title={t(titleKey)} icon="✍️">
      {error && <div className="mb-3 bg-red-950/60 border border-red-800 text-red-300 px-3 py-2 rounded text-xs">{error}</div>}
      {ok && <div className="mb-3 bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-3 py-2 rounded text-xs">{t('tk_sent')}</div>}

      <div className="space-y-3">
        {kind !== 'report' && (
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tk_kind')}</label>
            <div className="flex gap-1.5">
              {(['support', 'bug'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKindSel(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    kindSel === k
                      ? 'bg-red-900/50 border-red-700 text-red-300'
                      : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {k === 'support' ? `❓ ${t('tk_kind_support')}` : `🐛 ${t('tk_kind_bug')}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {withTarget && (
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tk_target')}</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t('tk_target_placeholder')}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tk_subject')}</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('tk_body')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
          <div className="text-[10px] text-zinc-600 text-right mt-0.5">{body.length}/2000</div>
        </div>

        <button
          onClick={submit}
          disabled={busy || subject.trim().length < 3 || body.trim().length < 3 || (withTarget && !target.trim())}
          className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {busy ? t('tk_sending') : t('tk_submit')}
        </button>
      </div>
    </Panel>
  );
}
