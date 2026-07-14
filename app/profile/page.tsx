'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto p-6 text-zinc-400" />}>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const { player } = usePlayer();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const viewUser = searchParams.get('user') || searchParams.get('username');

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = createClient();

      try {
        if (viewUser) {
          // Public lookup via RPC (RLS blocks reading other players' rows directly)
          const { data: found, error: lookupError } = await supabase
            .rpc('get_public_profile', { p_username: viewUser });

          if (found && !lookupError) {
            setProfile(found);
          } else {
            setError(t('profile_not_found'));
          }
        } else if (player) {
          // Show own full profile
          setProfile(player);
        }
      } catch (e: any) {
        setError(t('profile_load_failed'));
      }
      setLoading(false);
    };
    load();
  }, [viewUser, player]);

  if (loading) return <div className="p-8">{t('profile_loading')}</div>;

  const p = profile || player;
  if (!p) return <div className="p-8">{t('profile_no_data')} <Link href="/dashboard">{t('profile_go_back')}</Link></div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">👤 {t('profile_title')}</h1>
      <p className="text-zinc-400 mb-6">{p.username || t('profile_unknown')} {p.is_donator && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-500 text-black rounded">{t('profile_donator_badge')}</span>}</p>

      {error && <div className="text-red-400 mb-4">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <div className="text-xs text-zinc-500">{t('profile_level_section')}</div>
          <div className="text-2xl font-bold">{p.level}</div>
          <div className="text-sm mt-1">{t('profile_xp', { xp: p.xp || 0 })}</div>
          <div>{t('profile_health', { health: p.health || 100 })}</div>
          <div>{t('profile_murder_skill', { skill: (p.murder_skill || 0).toFixed(2) })}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">{t('profile_wealth_section')}</div>
          <div>{t('profile_cash')} <span className="font-mono">${(p.cash || 0).toLocaleString()}</span></div>
          <div>{t('profile_bank')} <span className="font-mono">${(p.personal_bank || 0).toLocaleString()}</span></div>
          <div>{t('profile_diamonds')} <span className="font-mono">{p.diamonds || 0} 💎</span></div>
          <div>{t('profile_power', { power: p.power || 0 })}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">{t('profile_record_section')}</div>
          <div>{t('profile_crimes_ok', { count: p.crimes_succeeded || 0 })}</div>
          <div>{t('profile_crimes_fail', { count: p.crimes_failed || 0 })}</div>
          <div>{t('profile_heat', { heat: p.heat || 0 })}</div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-zinc-500">{t('profile_status_section')}</div>
          <div>{t('profile_donator', { status: p.is_donator ? t('profile_donator_yes') : t('profile_donator_no') })}</div>
          {p.donator_since && <div className="text-xs">{t('profile_since', { date: new Date(p.donator_since).toLocaleDateString() })}</div>}
          <div>{t('profile_protection', { value: p.protection || 0 })}</div>
          <div>{t('profile_bullets', { value: p.bullets || 0 })}</div>
        </div>
      </div>

      <div className="text-xs text-zinc-500">
        {t('profile_footer')}
        <br />
        <Link href="/families" className="text-red-400">{t('profile_back_families')}</Link> • <Link href="/dashboard" className="text-red-400">{t('nav_dashboard')}</Link>
      </div>
    </div>
  );
}
