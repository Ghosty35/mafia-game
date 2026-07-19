'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePlayer } from '../../components/PlayerContext';
import Panel from '../../components/Panel';
import { useMyFamily } from '../../components/useMyFamily';

type FamilySummary = {
  id: string;
  name: string;
  tag: string;
  respect: number;
  territory: number;
  member_count: number;
  power?: number;
};

export const dynamic = 'force-dynamic';

// Standalone "Join a Family" page (bug-inspectie menu spec): browse all
// families, send one pending join request, or found your own family.
export default function JoinFamilyPage() {
  const { t, fm } = useLanguage();
  const { refreshPlayer } = usePlayer();
  const router = useRouter();
  const { inFamily, loading: famLoading } = useMyFamily();

  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [topFamilies, setTopFamilies] = useState<FamilySummary[]>([]);
  const [myRequest, setMyRequest] = useState<{ request_id: string; family_id: string; family_name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const supabase = createClient();

  const load = async () => {
    const [listRes, reqRes, topRes] = await Promise.all([
      supabase.rpc('list_families'),
      supabase.rpc('get_my_join_request'),
      supabase.rpc('get_families_leaderboard'),
    ]);
    setFamilies(Array.isArray(listRes.data) ? listRes.data : []);
    setTopFamilies(Array.isArray(topRes.data?.top) ? topRes.data.top.slice(0, 10) : []);
    setMyRequest(reqRes.data?.request_id ? reqRes.data : null);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestJoin = async (familyId: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('request_join_family', { p_family_id: familyId });
    setBusy(false);
    if (err) {
      if (err.message.includes('ALREADY_IN_FAMILY')) setError(t('fj_err_already_in'));
      else if (err.message.includes('REQUEST_ALREADY_PENDING')) setError(t('fj_err_pending'));
      else setError(t('fj_err_request'));
      return;
    }
    await load();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
  };

  const cancelRequest = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('cancel_join_request');
    setBusy(false);
    if (err) {
      setError(t('fj_err_cancel'));
      return;
    }
    await load();
    if (refreshPlayer) await refreshPlayer();
    router.refresh();
  };

  const createFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.rpc('create_family', {
      p_name: newName,
      p_tag: newTag,
      p_description: newDesc || null,
    });
    setBusy(false);
    if (err) {
      const em = err.message || '';
      if (em.includes('ALREADY_IN_FAMILY')) setError(t('fj_err_already_in'));
      else if (em.includes('FAMILY_NAME_TAKEN')) setError(t('fj_err_name_taken'));
      else if (em.includes('FAMILY_TAG_TAKEN')) setError(t('fj_err_tag_taken'));
      else if (em.includes('INVALID_FAMILY_NAME')) setError(t('fj_err_name_invalid'));
      else if (em.includes('INVALID_FAMILY_TAG')) setError(t('fj_err_tag_invalid'));
      else if (em.includes('NO_USERNAME')) setError(t('fj_err_no_username'));
      else if (em.includes('INSUFFICIENT_FUNDS')) setError(t('fj_err_funds'));
      else if (em.includes('LEVEL_TOO_LOW')) setError(t('fj_err_level'));
      else setError(t('fj_err_create'));
      return;
    }
    if (refreshPlayer) await refreshPlayer();
    router.push('/families');
    router.refresh();
  };

  if (famLoading || loading) {
    return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  }

  if (inFamily) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('fj_title')} icon="🤝">
          <p className="text-sm text-zinc-300 mb-4">{t('fj_already_in_text')}</p>
          <Link href="/families" className="inline-block px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
            👥 {t('menu_my_family')}
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">🤝 {t('fj_title')}</h1>
        <p className="text-xs text-zinc-400">{t('fj_subtitle')}</p>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {myRequest && (
        <div className="bg-amber-950/50 border border-amber-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-amber-300">
            ⏳ {t('fj_pending_banner', { family: myRequest.family_name ?? '?' })}
          </span>
          <button onClick={cancelRequest} disabled={busy} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs shrink-0 disabled:opacity-50">
            {t('fj_cancel_request')}
          </button>
        </div>
      )}

      <Panel title={t('fj_browse_title')} icon="🏛️" bodyClassName="p-0">
        <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-5">{t('famlb_family')}</div>
          <div className="col-span-2 text-center">{t('famlb_tag')}</div>
          <div className="col-span-2 text-right">{t('famlb_respect')}</div>
          <div className="col-span-1 text-center">{t('famlb_members')}</div>
          <div className="col-span-2 text-right">{t('fam_col_actions')}</div>
        </div>
        {families.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('fj_none')}</div>
        )}
        {families.map((f) => (
          <div key={f.id} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
            <div className="col-span-5 truncate">
              <Link href={`/families/profile?id=${f.id}`} className="font-medium hover:text-red-400">{f.name}</Link>
            </div>
            <div className="col-span-2 text-center">
              <span className="inline-block bg-zinc-800 px-2 py-px rounded font-mono text-red-400 text-[10px] tracking-widest">{f.tag}</span>
            </div>
            <div className="col-span-2 text-right font-mono text-amber-400 text-xs tabular-nums">{f.respect.toLocaleString()}</div>
            <div className="col-span-1 text-center font-mono text-xs">{f.member_count}</div>
            <div className="col-span-2 text-right">
              {myRequest?.family_id === f.id ? (
                <button onClick={cancelRequest} disabled={busy} className="text-[11px] px-2.5 py-1 bg-amber-900/60 border border-amber-700 rounded text-amber-300">
                  ⏳ {t('fj_cancel_request')}
                </button>
              ) : (
                <button
                  onClick={() => requestJoin(f.id)}
                  disabled={busy || myRequest != null}
                  className="text-[11px] px-2.5 py-1 bg-zinc-800 hover:bg-red-700 rounded disabled:opacity-40"
                >
                  {f.member_count === 0 ? t('fj_revive') : t('fj_request')}
                </button>
              )}
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title={t('fj_create_title')}
        icon="👑"
        actions={
          <button onClick={() => setShowCreate((v) => !v)} className="text-[11px] px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
            {showCreate ? t('common_cancel') : t('fj_create_open')}
          </button>
        }
      >
        {!showCreate ? (
          <p className="text-sm text-zinc-400">{t('fj_create_teaser')}</p>
        ) : (
          <form onSubmit={createFamily} className="space-y-3 max-w-md">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('fj_create_name')}</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                required
                maxLength={32}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('fj_create_tag')}</label>
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value.toUpperCase())}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono"
                required
                maxLength={5}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('fj_create_desc')}</label>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                rows={2}
                maxLength={200}
              />
            </div>
            <div className="text-xs text-amber-400">{t('fj_create_cost', { cash: fm(2000000) })}</div>
            <button
              type="submit"
              disabled={busy || !newName || !newTag}
              className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 py-2.5 rounded-lg font-semibold text-sm"
            >
              {busy ? t('fj_creating') : t('fj_create_submit')}
            </button>
          </form>
        )}
      </Panel>

      {/* Top 10 families leaderboard — shows the power players below the join controls */}
      <Panel title={t('fj_top_title')} icon="👑" bodyClassName="p-0">
        <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-1">#</div>
          <div className="col-span-6">{t('famlb_family')}</div>
          <div className="col-span-2 text-right">{t('famlb_respect')}</div>
          <div className="col-span-1 text-center">{t('famlb_members')}</div>
          <div className="col-span-2 text-right">{t('fam_stat_power')}</div>
        </div>
        {topFamilies.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">{t('fj_none')}</div>
        ) : (
          topFamilies.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
              <div className="col-span-1 font-mono text-amber-400 text-xs">{i + 1}</div>
              <div className="col-span-6 truncate">
                <Link href={`/families/profile?id=${f.id}`} className="font-medium hover:text-red-400">{f.name}</Link>
              </div>
              <div className="col-span-2 text-right font-mono text-amber-400 text-xs tabular-nums">{f.respect.toLocaleString()}</div>
              <div className="col-span-1 text-center font-mono text-xs">{f.member_count}</div>
              <div className="col-span-2 text-right font-mono text-orange-400 text-xs tabular-nums">{f.power?.toLocaleString?.() ?? '—'}</div>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
