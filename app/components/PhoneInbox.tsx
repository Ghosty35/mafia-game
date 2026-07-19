'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type InboxMessage = {
  id: string;
  from_id: string | null;
  to_id: string | null;
  from_name: string | null;
  to_name: string | null;
  subject: string | null;
  body: string | null;
  read: boolean;
  mine: boolean;
  created_at: string;
};

type Thread = {
  key: string; // counterpart player id, or 'system'
  name: string;
  messages: InboxMessage[];
  unread: number;
  lastAt: number;
};

const SYSTEM_KEY = 'system';

export default function PhoneInbox() {
  const { player, showToast } = usePlayer();
  const { t, language } = useLanguage();
  const [msgs, setMsgs] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_my_inbox', { p_limit: 200 });
    if (data) setMsgs(data as InboxMessage[]);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, []);

  // Group into phone-style threads by counterpart.
  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    for (const m of msgs) {
      const counterpartId = m.mine ? m.to_id : m.from_id;
      const key = counterpartId ?? SYSTEM_KEY;
      const name =
        key === SYSTEM_KEY
          ? t('msg_system')
          : (m.mine ? m.to_name : m.from_name) || t('msg_unknown');
      let th = map.get(key);
      if (!th) {
        th = { key, name, messages: [], unread: 0, lastAt: 0 };
        map.set(key, th);
      }
      th.messages.push(m);
      if (!m.mine && !m.read) th.unread++;
      th.lastAt = Math.max(th.lastAt, Date.parse(m.created_at));
    }
    for (const th of map.values()) {
      th.messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }
    return Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
  }, [msgs, t]);

  const activeThread = threads.find((th) => th.key === selected) ?? null;

  // Opening a thread marks its incoming messages as read. Direct writes to
  // `messages` were removed in migration 130 (a recipient could otherwise
  // rewrite any column); this goes through the mark_messages_read RPC, which
  // only ever flips read=true on the caller's own inbound messages.
  useEffect(() => {
    if (!player || !activeThread || activeThread.unread === 0) return;
    const markRead = async () => {
      const supabase = createClient();
      await (activeThread.key === SYSTEM_KEY
        ? supabase.rpc('mark_messages_read', { p_system: true })
        : supabase.rpc('mark_messages_read', { p_from: activeThread.key }));
      setMsgs((prev) =>
        prev.map((m) => {
          const cp = m.mine ? m.to_id : m.from_id;
          return (cp ?? SYSTEM_KEY) === activeThread.key && !m.mine ? { ...m, read: true } : m;
        }),
      );
    };
    markRead();
  }, [player?.id, activeThread?.key, activeThread?.unread, activeThread]);

  // Keep the bubble view pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeThread?.key, activeThread?.messages.length]);

  const mapErr = (msg: string): string => {
    if (msg.includes('MESSAGE_TOO_FAST')) return t('msg_err_too_fast');
    if (msg.includes('MESSAGE_TOO_LONG')) return t('msg_err_too_long');
    if (msg.includes('EMPTY_MESSAGE')) return t('msg_err_empty');
    if (msg.includes('TARGET_NOT_FOUND')) return t('msg_err_not_found');
    if (msg.includes('CANNOT_MESSAGE_SELF')) return t('msg_err_self');
    return msg;
  };

  const send = async (target: string) => {
    if (busy || !compose.trim() || !target) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('send_player_message', {
        target_username: target,
        p_body: compose.trim(),
      });
      if (error) {
        showToast(mapErr(error.message), 'error');
        return;
      }
      setCompose('');
      setNewChat(false);
      setNewTarget('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : 'en-GB',
      today ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
    ).format(d);
  };

  if (loading) return <div className="p-8 text-zinc-500">{t('messages_loading')}</div>;

  return (
    <div className="grid md:grid-cols-[280px_1fr] gap-4">
      {/* Thread list */}
      <div className={`card border border-zinc-700 bg-zinc-900 overflow-hidden ${activeThread || newChat ? 'hidden md:block' : ''}`}>
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="font-bold text-sm">📱 {t('msg_threads')}</span>
          <button
            onClick={() => { setNewChat(true); setSelected(null); }}
            className="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded"
          >
            ✏️ {t('msg_new')}
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-zinc-800/60">
          {threads.length === 0 && (
            <div className="p-4 text-xs text-zinc-500">{t('messages_none')}</div>
          )}
          {threads.map((th) => {
            const last = th.messages[th.messages.length - 1];
            return (
              <button
                key={th.key}
                onClick={() => { setSelected(th.key); setNewChat(false); }}
                className={`w-full text-left px-4 py-2.5 hover:bg-zinc-800/60 transition ${selected === th.key ? 'bg-zinc-800/80' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">
                    {th.key === SYSTEM_KEY ? '🏛️' : '👤'} {th.name}
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0">{fmtTime(last.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[11px] text-zinc-500 truncate">
                    {last.mine ? `${t('msg_you')}: ` : ''}{last.body}
                  </span>
                  {th.unread > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {th.unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation ("phone screen") */}
      <div className="card border border-zinc-700 bg-zinc-900 overflow-hidden flex flex-col min-h-[420px]">
        {newChat ? (
          <>
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
              <button onClick={() => setNewChat(false)} className="md:hidden text-zinc-400">←</button>
              <span className="font-bold text-sm">✏️ {t('msg_new_title')}</span>
            </div>
            <div className="p-4 space-y-3 flex-1">
              <label className="block text-sm">
                <span className="text-zinc-400 text-xs">{t('msg_to')}</span>
                <input
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  placeholder={t('msg_to_placeholder')}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm"
                />
              </label>
            </div>
            <Composer
              value={compose}
              onChange={setCompose}
              onSend={() => send(newTarget.trim())}
              disabled={busy || !newTarget.trim() || !compose.trim()}
              placeholder={t('msg_placeholder')}
              sendLabel={t('msg_send')}
            />
          </>
        ) : activeThread ? (
          <>
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
              <button onClick={() => setSelected(null)} className="md:hidden text-zinc-400">←</button>
              <span className="font-bold text-sm">
                {activeThread.key === SYSTEM_KEY ? '🏛️' : '👤'} {activeThread.name}
              </span>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[420px]">
              {activeThread.messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.mine
                        ? 'bg-red-800/90 text-white rounded-br-sm'
                        : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
                    }`}
                  >
                    {m.subject && m.subject !== 'dm' && (
                      <div className="text-[10px] font-bold text-zinc-300 mb-0.5">{m.subject}</div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[9px] mt-1 ${m.mine ? 'text-red-200/70' : 'text-zinc-500'}`}>
                      {fmtTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {activeThread.key !== SYSTEM_KEY ? (
              <Composer
                value={compose}
                onChange={setCompose}
                onSend={() => send(activeThread.name)}
                disabled={busy || !compose.trim()}
                placeholder={t('msg_placeholder')}
                sendLabel={t('msg_send')}
              />
            ) : (
              <div className="px-4 py-2.5 border-t border-zinc-800 text-[10px] text-zinc-500">
                {t('msg_system_note')}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-600 p-8">
            {t('msg_pick_thread')}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({
  value, onChange, onSend, disabled, placeholder, sendLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  sendLabel: string;
}) {
  return (
    <div className="border-t border-zinc-800 p-3 flex gap-2">
      <input
        value={value}
        maxLength={500}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) onSend(); }}
        placeholder={placeholder}
        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-full px-4 py-2 text-sm"
      />
      <button
        onClick={onSend}
        disabled={disabled}
        className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded-full text-sm font-semibold"
      >
        {sendLabel} ➤
      </button>
    </div>
  );
}
