'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { TranslationKey } from '@/lib/i18n/translations';

type FamilyMessage = {
  id: number;
  from_username: string;
  from_role: string;
  audience: 'all' | 'higherups';
  body: string;
  created_at: string;
  mine: boolean;
};

type JoinRequest = {
  id: string;
  username: string;
  level: number;
  message: string | null;
  created_at: string;
};

type InboxData = {
  my_role: string;
  can_broadcast: boolean;
  is_higherup: boolean;
  can_manage_requests: boolean;
  messages: FamilyMessage[];
  join_requests: JoinRequest[] | null;
};

const ERROR_KEYS: Record<string, TranslationKey> = {
  NOT_IN_FAMILY: 'fi_err_not_in_family',
  NOT_AUTHORIZED: 'fi_err_not_authorized',
  MESSAGE_TOO_FAST: 'fi_err_too_fast',
  MESSAGE_TOO_LONG: 'fi_err_too_long',
  EMPTY_MESSAGE: 'fi_err_empty',
  REQUEST_ALREADY_RESOLVED: 'fi_err_request_resolved',
  TARGET_ALREADY_IN_FAMILY: 'fi_err_target_taken',
};

function timeAgo(iso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function FamilyInboxBoard() {
  const { t } = useLanguage();
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [notInFamily, setNotInFamily] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'higherups'>('all');
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const load = async () => {
    // No unmount guard (dev StrictMode double-mount, see MostWantedBoard).
    const { data, error: err } = await supabase.rpc('get_family_inbox', { p_limit: 50 });
    if (err) {
      if (err.message.includes('NOT_IN_FAMILY')) setNotInFamily(true);
    } else if (data) {
      setInbox(data as InboxData);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, 10000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

   useEffect(() => {
     const tick = setInterval(() => {
       setNow(Date.now());
     }, 30000);
     return () => clearInterval(tick);
   }, []);

  // keep the newest message in view
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [inbox?.messages?.length]);

  // members without broadcast rights can only write to the leadership
   useEffect(() => {
     if (inbox && !inbox.can_broadcast) {
       setAudience('higherups');
     }
   }, [inbox?.can_broadcast, inbox]);

  const translateError = (message: string): string => {
    for (const token of Object.keys(ERROR_KEYS)) {
      if (message.includes(token)) return t(ERROR_KEYS[token]);
    }
    return message;
  };

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('send_family_message', {
      p_body: body.trim(),
      p_audience: audience,
    });
    if (err) setError(translateError(err.message));
    else setBody('');
    await load();
    setBusy(false);
  };

  const respond = async (requestId: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('respond_join_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    if (err) setError(translateError(err.message));
    await load();
    setBusy(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500 text-sm">{t('fi_loading')}</div>;
  }

  if (notInFamily) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <p className="text-zinc-400 text-sm mb-3">{t('fi_no_family')}</p>
        <Link href="/families" className="text-red-400 text-sm hover:underline">
          {t('fi_browse_families')} →
        </Link>
      </div>
    );
  }

  if (!inbox) {
    return <div className="p-8 text-center text-zinc-500 text-sm">{t('fi_loading')}</div>;
  }

  const requests = inbox.join_requests ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}

      {/* ---- pending join requests (boss/underboss) ---- */}
      {inbox.can_manage_requests && requests.length > 0 && (
        <div className="bg-zinc-900 border border-amber-900/60 rounded-xl overflow-hidden text-sm">
          <div className="bg-gradient-to-r from-amber-950 to-zinc-900 px-4 py-2">
            <h2 className="font-bold tracking-tight">🚪 {t('fi_requests_title')} ({requests.length})</h2>
          </div>
          {requests.map((r) => (
            <div key={r.id} className="px-4 py-2.5 border-t border-zinc-800 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-0">
                <Link href={`/profile?user=${r.username}`} className="font-semibold text-red-400 hover:underline">
                  {r.username}
                </Link>{' '}
                <span className="text-xs text-zinc-500">Lvl {r.level} · {timeAgo(r.created_at, now)}</span>
                 {r.message && <p className="text-xs text-zinc-400 italic truncate">&quot;{r.message}&quot;</p>}
              </div>
              <button
                onClick={() => respond(r.id, true)}
                disabled={busy}
                className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-bold"
              >
                ✓ {t('fi_accept')}
              </button>
              <button
                onClick={() => respond(r.id, false)}
                disabled={busy}
                className="px-3 py-1 rounded bg-zinc-700 hover:bg-red-700 disabled:opacity-40 text-xs font-bold"
              >
                ✗ {t('fi_reject')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---- message feed ---- */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden text-sm">
        <div className="bg-gradient-to-r from-red-950 to-zinc-900 px-4 py-2 flex items-center justify-between">
          <h2 className="font-bold tracking-tight">📥 {t('fi_title')}</h2>
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
            {t('fi_role_label')}: {inbox.my_role}
          </span>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto">
          {inbox.messages.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">{t('fi_empty')}</div>
          ) : (
            inbox.messages.map((m) => (
              <div
                key={m.id}
                className={`px-4 py-2 border-t border-zinc-800/60 ${m.mine ? 'bg-zinc-800/30' : ''}`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-red-400">{m.from_username}</span>
                  <span className="text-zinc-500">{m.from_role}</span>
                  {m.audience === 'higherups' ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/70 text-amber-300 font-bold">
                      🔒 {t('fi_ch_higherups')}
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-bold">
                      📢 {t('fi_ch_all')}
                    </span>
                  )}
                  <span className="text-zinc-600 ml-auto shrink-0">{timeAgo(m.created_at, now)}</span>
                </div>
                <p className="text-zinc-200 mt-0.5 break-words whitespace-pre-wrap">{m.body}</p>
              </div>
            ))
          )}
        </div>

        {/* ---- composer ---- */}
        <div className="border-t border-zinc-800 p-3 space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t('fi_placeholder')}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as 'all' | 'higherups')}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
            >
              {inbox.can_broadcast && <option value="all">📢 {t('fi_aud_all')}</option>}
              <option value="higherups">🔒 {t('fi_aud_higherups')}</option>
            </select>
            {!inbox.can_broadcast && (
              <span className="text-[10px] text-zinc-500">{t('fi_member_hint')}</span>
            )}
            <button
              onClick={send}
              disabled={busy || !body.trim()}
              className="ml-auto px-4 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 text-xs font-bold"
            >
              {t('fi_send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
