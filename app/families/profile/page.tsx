'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';
import { useMyFamily } from '../../components/useMyFamily';

type FamilyProfile = {
  id: string;
  name: string;
  tag: string;
  description: string | null;
  created_at: string;
  respect: number;
  power: number;
  wars_won: number;
  member_count: number;
  boss: string | null;
  members: Array<{ username: string | null; role: string; level?: number; joined_at?: string }>;
  territories: string[];
};

export const dynamic = 'force-dynamic';

// Public family profile (bug-inspectie: "Familie profile needs to show
// information about the family, creation, members" — Bulletstar layout in
// our design). Defaults to your own family; ?id= shows any family.
export default function FamilyProfilePage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm" />}>
      <FamilyProfileContent />
    </Suspense>
  );
}

function FamilyProfileContent() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'nl' ? 'nl-NL' : 'en-US';
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id');
  const { data: myFam, loading: famLoading } = useMyFamily();

  const [profile, setProfile] = useState<FamilyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const familyId = idParam || myFam?.family?.id || null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [profile?.id]);

  useEffect(() => {
    if (famLoading) return;
    if (!familyId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    const load = async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc('get_family_profile', { p_family_id: familyId });
      if (err) {
        // Function ships with migration 074 — show a friendly notice until it's
        // live. Store a code, not translated text: the saved language loads
        // after mount, so early t() calls would freeze the wrong language.
        setError(err.message.includes('FAMILY_NOT_FOUND') ? 'not_found' : 'unavailable');
      } else {
        setProfile(data as FamilyProfile);
      }
      setLoading(false);
    };
    load();
  }, [familyId, famLoading]);

  if (loading || famLoading) {
    return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  }

  if (!familyId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('fp_title')} icon="📋">
          <p className="text-sm text-zinc-300 mb-4">{t('fp_no_family')}</p>
          <div className="flex gap-3">
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

  if (error || !profile) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Panel title={t('fp_title')} icon="📋">
          <p className="text-sm text-amber-300">{error === 'not_found' ? t('fp_not_found') : t('fp_unavailable')}</p>
        </Panel>
      </div>
    );
  }

  const ageDays = Math.max(0, Math.floor((now - new Date(profile.created_at).getTime()) / 86400000));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Crest header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-red-900 to-zinc-900 border border-red-800/60 flex items-center justify-center font-mono font-bold text-red-300 tracking-widest">
          {profile.tag}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{profile.name}</h1>
          <div className="text-xs text-zinc-400">
            👑 {t('fp_boss')}: <span className="text-amber-400 font-semibold">{profile.boss ?? '—'}</span>
            <span className="ml-2 text-zinc-500">
              • {t('fam_founded', { date: new Date(profile.created_at).toLocaleDateString(dateLocale) })} ({t('fp_age_days', { days: ageDays })})
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: t('fam_stat_respect'), value: profile.respect.toLocaleString(), color: 'text-amber-400' },
          { label: t('fam_stat_power'), value: profile.power.toLocaleString(), color: 'text-orange-400' },
          { label: t('fam_stat_wars_won'), value: profile.wars_won.toLocaleString(), color: 'text-red-400' },
          { label: t('fam_stat_members'), value: profile.member_count.toLocaleString(), color: 'text-white' },
          { label: t('fam_stat_territories'), value: profile.territories.length.toLocaleString(), color: 'text-emerald-400' },
        ].map((s, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
            <div className={`font-mono font-semibold tabular-nums text-sm ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* About */}
      {profile.description && (
        <Panel title={t('fam_about_title')} icon="📜">
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{profile.description}</p>
        </Panel>
      )}

      {/* Territories */}
      <Panel title={t('fam_turf_title')} icon="🗺️">
        {profile.territories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {profile.territories.map((city) => (
              <span key={city} className="px-3 py-1 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded-full text-xs font-semibold">
                🏙️ {city}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{t('fp_turf_none')}</p>
        )}
      </Panel>

      {/* Members */}
      <Panel title={`${t('fam_members_title')} (${profile.member_count})`} icon="👥" bodyClassName="p-0">
        <div className="grid grid-cols-12 bg-zinc-950/60 px-4 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-6">{t('fam_col_member')}</div>
          <div className="col-span-4">{t('fam_col_role')}</div>
          <div className="col-span-2 text-right">{t('fam_col_level')}</div>
        </div>
        {profile.members.map((m, i) => (
          <div key={i} className="grid grid-cols-12 px-4 py-2 border-t border-zinc-800 items-center text-sm hover:bg-zinc-800/40">
            <div className="col-span-6 truncate">
              <Link href={`/profile?user=${encodeURIComponent(m.username ?? '')}`} className="font-medium hover:text-red-400">
                {m.username ?? '?'}
              </Link>
            </div>
            <div className="col-span-4">
              <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wide font-semibold ${
                m.role === 'boss' ? 'bg-amber-900/50 text-amber-300' :
                m.role === 'underboss' ? 'bg-orange-900/50 text-orange-300' :
                'bg-zinc-800 text-zinc-400'
              }`}>
                {m.role}
              </span>
            </div>
            <div className="col-span-2 text-right font-mono text-xs text-zinc-300">{m.level ?? '—'}</div>
          </div>
        ))}
      </Panel>

      <div className="flex gap-3 text-xs">
        <Link href="/families/leaderboard" className="text-red-400 hover:underline">👑 {t('menu_families_leaderboard')}</Link>
        <Link href="/families" className="text-red-400 hover:underline">👥 {t('menu_my_family')}</Link>
      </div>
    </div>
  );
}
