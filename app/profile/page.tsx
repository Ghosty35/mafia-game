'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRank, getNextRank } from '@/lib/ranks';
import Panel from '../components/Panel';
import Avatar from '../components/Avatar';
import type { TranslationKey } from '@/lib/i18n/translations';
import { useRouter } from 'next/navigation';
import type { PublicProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

// My Profile (bug-inspectie): richer player info; the settings section is
// own-view only — other players only ever see the public card.
export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto p-6 text-zinc-400" />}>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm, language } = useLanguage();
  const router = useRouter();
  const dateLocale = language === 'nl' ? 'nl-NL' : 'en-US';
  const searchParams = useSearchParams();
  const viewUser = searchParams.get('user') || searchParams.get('username');

  const handleProfileSaved = async () => {
    await refreshPlayer();
    await router.refresh();
  };

  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [findMsg, setFindMsg] = useState('');
  const [findBusy, setFindBusy] = useState(false);

  const findBithes = async () => {
    if (!viewUser) return;
    setFindBusy(true);
    setFindMsg('');
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc('find_bitches', { p_target_username: viewUser });
    setFindBusy(false);
    if (err) {
      const m = err.message || '';
      if (m.includes('FIND_ON_COOLDOWN')) setFindMsg(t('prof_find_bitches_cooldown'));
      else if (m.includes('BITCH_LIMIT')) setFindMsg(t('prof_find_bitches_limit'));
      else if (m.includes('IN_JAIL')) setFindMsg(t('rl_err_in_jail'));
      else if (m.includes('DEAD')) setFindMsg(t('rl_err_dead'));
      else setFindMsg(m);
    } else if (data?.success) {
      setFindMsg(t('prof_find_bitches_done', { added: data.added, city: data.city }));
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
    }
  };

  // Viewing someone else only when the name differs from our own.
  const isOwn = !viewUser || (player?.username != null && viewUser.toLowerCase() === player.username.toLowerCase());

  useEffect(() => {
    const load = async () => {
      if (isOwn) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc('get_public_profile', { p_username: viewUser });
      if (err || !data) {
        // Store a flag, not translated text — the saved language loads after
        // mount, so early t() calls would freeze the wrong language.
        setError('not_found');
      } else {
        setPublicProfile(data);
      }
      setLoading(false);
    };
    load();
  }, [viewUser, isOwn]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(tick);
  }, []);

  if (loading || (isOwn && !player)) {
    return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('profile_loading')}</div>;
  }

  const p = isOwn ? player : publicProfile;
  if (!p) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-sm">
        {error ? t('profile_not_found') : t('profile_no_data')}{' '}
        <Link href="/dashboard" className="text-red-400 hover:underline">{t('profile_go_back')}</Link>
      </div>
    );
  }

  const rank = getRank(Number(p.level ?? 1));
  const nextRank = getNextRank(Number(p.level ?? 1));
  const online = p.last_active && now - new Date(p.last_active as string).getTime() < 15 * 60 * 1000;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Identity header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center gap-4">
        <Avatar src={p.avatar_url as string | null} name={String(p.username ?? '')} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{String(p.username) || t('profile_unknown')}</h1>
            {p.is_donator && <span className="px-2 py-0.5 text-[10px] bg-amber-500 text-black rounded font-bold uppercase">{t('profile_donator_badge')}</span>}
            {(p.rebirths ?? 0) > 0 && <span className="px-2 py-0.5 text-[10px] bg-purple-900/70 text-purple-300 rounded font-bold">♻️ {p.rebirths}</span>}
            {p.last_active != null && (
              <span className={`px-2 py-0.5 text-[10px] rounded font-semibold ${online ? 'bg-emerald-900/60 text-emerald-300' : 'bg-zinc-800 text-zinc-500'}`}>
                {online ? `● ${t('prof_online')}` : t('prof_offline')}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            {t('prof_rank_line', { rank: t(rank.key as TranslationKey), level: p.level ?? 1 })}
            {nextRank && isOwn && <span className="text-zinc-500 ml-2">→ {t(nextRank.key as TranslationKey)} (lvl {nextRank.minLevel})</span>}
          </div>
          {(p.family_name || (isOwn && player?.family_id)) && (
            <div className="text-xs text-zinc-400 mt-0.5">
              👥 {t('prof_family')}:{' '}
              {p.family_name ? (
                <Link href={`/families/profile?id=${p.family_id}`} className="text-red-400 hover:underline">
                  {p.family_name} {p.family_tag && <span className="font-mono text-[10px]">[{p.family_tag}]</span>}
                </Link>
              ) : (
                <Link href="/families" className="text-red-400 hover:underline">{t('menu_my_family')}</Link>
              )}
            </div>
          )}
          {p.bio && <p className="text-xs text-zinc-300 mt-2 whitespace-pre-wrap">{p.bio}</p>}
          {!isOwn && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={findBithes}
                disabled={findBusy}
                className="px-3 py-1.5 rounded bg-pink-700 hover:bg-pink-600 disabled:opacity-40 text-xs font-bold"
              >
                {findBusy ? '…' : '🔎 ' + t('prof_find_bitches')}
              </button>
              {findMsg && <span className="text-[11px] text-emerald-400">{findMsg}</span>}
            </div>
          )}
        </div>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{t('profile_not_found')}</div>}

      {/* Stats grid — public stats for everyone */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: t('prof_stat_level'), value: String(p.level ?? 1), color: 'text-white' },
          { label: t('prof_stat_health'), value: `${p.health ?? 100}%`, color: 'text-red-400' },
          { label: t('prof_stat_power'), value: (p.power ?? 0).toLocaleString(), color: 'text-orange-400' },
          { label: t('prof_stat_protection'), value: String(p.protection ?? 0), color: 'text-sky-400' },
          { label: t('prof_stat_crimes_ok'), value: (p.crimes_succeeded ?? 0).toLocaleString(), color: 'text-emerald-400' },
          { label: t('prof_stat_crimes_fail'), value: (p.crimes_failed ?? 0).toLocaleString(), color: 'text-zinc-400' },
          { label: t('prof_stat_murder'), value: (p.murder_skill ?? 0).toFixed(2), color: 'text-red-400' },
          { label: t('prof_stat_member_since'), value: p.created_at ? new Date(p.created_at).toLocaleDateString(dateLocale) : '—', color: 'text-zinc-300' },
        ].map((s, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
            <div className={`font-mono font-semibold tabular-nums text-sm ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Own-view only: private wealth + condition */}
      {isOwn && player && (
        <>
          <Panel title={t('prof_private_title')} icon="🔒">
            <p className="text-[11px] text-zinc-500 mb-3">{t('prof_private_note')}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: t('prof_cash'), value: fm(player.cash ?? 0), color: 'text-emerald-400' },
                { label: t('prof_bank'), value: fm(player.personal_bank ?? 0), color: 'text-emerald-400' },
                { label: t('prof_dirty'), value: fm(player.dirty_cash ?? 0), color: 'text-red-400' },
                { label: t('prof_diamonds'), value: `${(player.diamonds ?? 0).toLocaleString()} 💎`, color: 'text-yellow-400' },
                { label: t('prof_heat'), value: `${player.heat ?? 0}`, color: 'text-orange-400' },
                { label: t('prof_bullets'), value: (player.bullets ?? 0).toLocaleString(), color: 'text-zinc-300' },
                { label: t('prof_strength'), value: String(player.strength ?? 10), color: 'text-red-400' },
                { label: t('prof_defense'), value: String(player.defense ?? 10), color: 'text-sky-400' },
              ].map((s, i) => (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
                  <div className={`font-mono font-semibold tabular-nums text-sm ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </Panel>

          <ProfileSettings onSaved={handleProfileSaved} />
        </>
      )}

      <div className="text-xs text-zinc-500">
        <Link href="/leaderboard" className="text-red-400 hover:underline">🏆 {t('menu_leaderboard')}</Link>
        {' • '}
        <Link href="/dashboard" className="text-red-400 hover:underline">{t('nav_dashboard')}</Link>
      </div>
    </div>
  );
}

// Own-view settings: avatar + bio, saved via the profile-only
// update_my_state RPC (all other player fields are server-owned).
function ProfileSettings({ onSaved }: { onSaved?: () => Promise<void> | void }) {
  const { t } = useLanguage();
  const { player } = usePlayer();
  const [avatarUrl, setAvatarUrl] = useState(player?.avatar_url ?? '');
  const [bio, setBio] = useState(player?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.rpc('update_my_state', {
      patch: { avatar_url: avatarUrl.trim() || null, bio: bio.trim() || null },
    });
    setBusy(false);
    if (error) {
      setMsg(t('prof_settings_failed'));
      return;
    }
    if (onSaved) await onSaved();
    setMsg(t('prof_settings_saved'));
  };

  return (
    <Panel
      title={t('prof_settings_title')}
      icon="⚙️"
      actions={<span className="text-[10px] text-zinc-500">{t('prof_settings_own_only')}</span>}
    >
      <div className="space-y-3 max-w-lg">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">{t('prof_settings_avatar')}</label>
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            maxLength={300}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">{t('prof_settings_bio')}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={300}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            placeholder={t('prof_settings_bio_ph')}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="px-5 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? t('prof_settings_saving') : t('prof_settings_save')}
          </button>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        </div>
      </div>
    </Panel>
  );
}
