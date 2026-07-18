'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';

export const dynamic = 'force-dynamic';

type PlayerWithoutFamily = {
  id: string;
  username: string;
  level: number;
  power: number;
  created_at: string;
  last_active: string;
  is_online: boolean;
};

export default function PlayersWithoutFamilyPage() {
  const { t, fm } = useLanguage();
  const supabase = createClient();

  const [players, setPlayers] = useState<PlayerWithoutFamily[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.rpc('get_players_without_family');
      if (data) setPlayers(data as PlayerWithoutFamily[]);
      setLoading(false);
    };
    load();
  }, [supabase]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/families" className="text-sm text-red-400 hover:text-red-300 transition-colors">
          ← {t('menu_my_family')}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">👤 {t('pwf_title')}</h1>
        <p className="text-xs text-zinc-400">{t('pwf_subtitle')}</p>
      </div>

      <Panel title={t('pwf_title')} icon="👤" bodyClassName="p-0">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('loading')}</div>
        ) : players.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('pwf_none')}</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {players.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/30">
                <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm">
                  {p.is_online ? '🟢' : '⚫'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{p.username}</div>
                  <div className="text-[11px] text-zinc-500">
                    Level {p.level} • Power {fm(p.power)} • Account created {new Date(p.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-[10px] text-zinc-600">
                    Last active: {new Date(p.last_active).toLocaleString()}
                  </div>
                </div>
                <div className="shrink-0">
                  {p.is_online && (
                    <span className="text-[10px] px-2 py-1 bg-emerald-900/50 text-emerald-300 rounded font-semibold">ONLINE</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
