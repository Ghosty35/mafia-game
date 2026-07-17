'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../components/Panel';
import { useMyFamily, type FamilyMember } from '../components/useMyFamily';
import type { TranslationKey } from '@/lib/i18n/translations';

export const dynamic = 'force-dynamic';

// Role ladder, highest first. Order doubles as promotion ranking.
const ROLES = ['boss', 'underboss', 'accountant', 'manager', 'caporegime', 'soldier', 'associate'];

export default function MyFamilyPage() {
  const { t, fm, language } = useLanguage();
  const dateLocale = language === 'nl' ? 'nl-NL' : 'en-US';
  const router = useRouter();
  const { data, loading, reload, inFamily, isLeader, canManageMembers } = useMyFamily();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const fam = data?.family;

  // Only translate roles we know; unknown values render raw instead of crashing t().
  const roleLabel = (role: string | null | undefined) =>
    role && ROLES.includes(role) ? t(`fam_role_${role}` as TranslationKey) : role ?? '—';

  const changeRole = async (m: FamilyMember, newRole: string) => {
    if (!m.player_id || newRole === m.role) return;
    const action = ROLES.indexOf(newRole) < ROLES.indexOf(m.role) ? 'promote' : 'demote';
    if (!confirm(t(action === 'promote' ? 'fam_confirm_promote' : 'fam_confirm_demote', { name: m.username ?? '?', role: newRole }))) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc(action === 'promote' ? 'promote_member' : 'demote_member', {
      p_target_player_id: m.player_id,
      p_new_role: newRole,
    });
    setBusy(false);
    if (err) {
      if (err.message.includes('NOT_AUTHORIZED')) setError(t('fam_err_not_authorized'));
      else if (err.message.includes('MAX_2_MANAGERS')) setError(t('fam_err_max_managers'));
      else setError(t('fam_err_role_change'));
      return;
    }
    await reload();
  };

  const kick = async (m: FamilyMember) => {
    if (!m.player_id) return;
    if (!confirm(t('fam_confirm_kick', { name: m.username ?? '?' }))) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('kick_member', { p_target_player_id: m.player_id });
    setBusy(false);
    if (err) {
      setError(err.message.includes('NOT_AUTHORIZED') ? t('fam_err_kick_authorized') : t('fam_err_kick'));
      return;
    }
    await reload();
  };

  // Leaving costs a fee and puts a bounty on your head (077), so it gets its
  // own page to explain the deal rather than a bare confirm() here.

  if (loading) {
    return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  }

  if (!inFamily || !fam) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight mb-1">👥 {t('fam_title')}</h1>
        <p className="text-xs text-zinc-400 mb-6">{t('fam_subtitle')}</p>
        <Panel title={t('fam_none_title')} icon="🕶️">
          <p className="text-sm text-zinc-300 mb-4">{t('fam_none_text')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/families/join" className="px-5 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold">
              {t('fam_none_join')}
            </Link>
            <Link href="/families/leaderboard" className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">
              {t('menu_families_leaderboard')}
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const territories: string[] = data?.territories ?? [];
  const membersHaveIds = data?.members?.some((m) => m.player_id);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-900 to-zinc-900 border border-red-800/60 flex items-center justify-center font-mono font-bold text-red-300 text-sm tracking-widest">
            {fam.tag}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight">{fam.name}</h1>
            <div className="text-xs text-zinc-400">
              {t('fam_your_role')}: <span className="text-amber-400 font-semibold capitalize">{roleLabel(data?.my_role)}</span>
              {fam.created_at && (
                <span className="ml-2 text-zinc-500">• {t('fam_founded', { date: new Date(fam.created_at).toLocaleDateString(dateLocale) })}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/families/profile" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg">📋 {t('menu_family_profile')}</Link>
          <Link href="/families/inbox" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg">📥 {t('menu_family_inbox')}</Link>
        </div>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: t('fam_stat_respect'), value: fam.respect.toLocaleString(), color: 'text-amber-400' },
          { label: t('fam_stat_power'), value: (fam.power ?? 0).toLocaleString(), color: 'text-orange-400' },
          { label: t('fam_stat_wars_won'), value: (fam.wars_won ?? 0).toLocaleString(), color: 'text-red-400' },
          { label: t('fam_stat_members'), value: fam.member_count.toLocaleString(), color: 'text-white' },
          { label: t('fam_stat_territories'), value: (territories.length || fam.territory).toLocaleString(), color: 'text-emerald-400' },
          { label: t('fam_stat_bank'), value: fm(fam.bank ?? 0), color: 'text-emerald-400' },
        ].map((s, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
            <div className={`font-mono font-semibold tabular-nums text-sm ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Quick links to the family suite */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Link href="/families/bank" className="card px-4 py-3 hover:border-amber-700 transition flex items-center gap-2">💰 {t('menu_family_bank')}</Link>
        <Link href="/families/donations" className="card px-4 py-3 hover:border-emerald-700 transition flex items-center gap-2">🎁 {t('menu_family_donations')}</Link>
        <Link href="/territories" className="card px-4 py-3 hover:border-red-700 transition flex items-center gap-2">🗺️ {t('menu_territories')}</Link>
        <Link href="/families/leaderboard" className="card px-4 py-3 hover:border-zinc-500 transition flex items-center gap-2">👑 {t('menu_families_leaderboard')}</Link>
      </div>

      {/* Territories */}
      <Panel title={t('fam_turf_title')} icon="🗺️">
        {territories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {territories.map((city) => (
              <span key={city} className="px-3 py-1 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded-full text-xs font-semibold">
                🏙️ {city}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            {t('fam_turf_none')}{' '}
            <Link href="/territories" className="text-red-400 hover:underline">{t('fam_turf_claim')}</Link>
          </p>
        )}
      </Panel>

      {/* Members */}
      <Panel
        title={`${t('fam_members_title')} (${fam.member_count})`}
        icon="👥"
        actions={canManageMembers ? <span className="text-[10px] text-amber-400">{t('fam_members_mgmt_on')}</span> : undefined}
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-4">{t('fam_col_member')}</div>
          <div className="col-span-3">{t('fam_col_role')}</div>
          <div className="col-span-1 text-right">{t('fam_col_level')}</div>
          <div className="col-span-2 text-right">{t('fam_col_donated')}</div>
          <div className="col-span-2 text-right">{t('fam_col_actions')}</div>
        </div>
        {(data?.members ?? []).map((m, i) => {
          const manageable = canManageMembers && m.role !== 'boss' && !!m.player_id;
          return (
            <div key={m.player_id ?? i} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
              <div className="col-span-4 truncate">
                <Link href={`/profile?user=${encodeURIComponent(m.username ?? '')}`} className="font-medium hover:text-red-400">
                  {m.username ?? '?'}
                </Link>
              </div>
              <div className="col-span-3">
                <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wide font-semibold ${
                  m.role === 'boss' ? 'bg-amber-900/50 text-amber-300' :
                  m.role === 'underboss' ? 'bg-orange-900/50 text-orange-300' :
                  'bg-zinc-800 text-zinc-400'
                }`}>
                  {roleLabel(m.role)}
                </span>
              </div>
              <div className="col-span-1 text-right font-mono text-xs text-zinc-300">{m.level ?? '—'}</div>
              <div className="col-span-2 text-right font-mono text-xs text-emerald-400">{m.donated != null ? fm(m.donated) : '—'}</div>
              <div className="col-span-2 flex justify-end gap-1.5">
                {manageable ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      disabled={busy}
                      className="bg-zinc-800 text-[11px] rounded px-1.5 py-0.5 border border-zinc-700"
                    >
                      {ROLES.slice(1).map((r) => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                    {isLeader && (
                      <button onClick={() => kick(m)} disabled={busy} className="text-[11px] px-2 py-0.5 bg-red-900/60 hover:bg-red-800 rounded text-red-300">
                        {t('fam_kick')}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-zinc-700 text-xs">—</span>
                )}
              </div>
            </div>
          );
        })}
        {canManageMembers && !membersHaveIds && (
          <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">{t('fam_members_mgmt_pending')}</div>
        )}
      </Panel>

      {/* Description */}
      {fam.description && (
        <Panel title={t('fam_about_title')} icon="📜">
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{fam.description}</p>
        </Panel>
      )}

      {/* Leave */}
      <div className="flex justify-end">
        <Link href="/families/leave" className="px-4 py-2 bg-zinc-900 border border-zinc-700 hover:border-red-800 hover:text-red-400 rounded-lg text-xs">
          🚪 {t('fam_leave')}
        </Link>
      </div>
    </div>
  );
}
