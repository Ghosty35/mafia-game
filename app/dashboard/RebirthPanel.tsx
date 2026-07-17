'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Player } from '@/lib/types';

export default function RebirthPanel({
  player,
  onPlayerUpdate,
  onReborn,
}: {
  player: Player;
  onPlayerUpdate: (p: Player) => void;
  onReborn: (message: string) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const doRebirth = async () => {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('rebirth');
    setBusy(false);
    setConfirming(false);

    if (error) {
      setDone(
        error.message.includes('NOT_GODFATHER')
          ? t('error_not_godfather')
          : t('error_generic')
      );
      return;
    }

    const reborn = data as Player;
    onReborn(
      t('rebirth_done').replace('{bonus}', String((reborn.rebirths || 1) * 50))
    );
    onPlayerUpdate(reborn);
    router.refresh();
  };

  return (
    <section className="card bg-gradient-to-r from-yellow-950/70 to-zinc-900 border border-yellow-800 px-5 py-4 mb-6">
      <h2 className="font-semibold text-yellow-400 mb-1 flex items-center gap-2 text-sm tracking-wider">
        👑 {t('rebirth_title').toUpperCase()}
      </h2>

      {done ? (
        <p className="text-yellow-300 font-semibold">{done}</p>
      ) : (
        <>
          <p className="text-zinc-400 text-sm mb-3 leading-snug">{t('rebirth_desc')}</p>

          {confirming ? (
            <div>
              <p className="text-yellow-200 font-semibold mb-3">
                ⚠️ {t('rebirth_confirm_text')}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={doRebirth}
                  disabled={busy}
                  className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black px-6 py-2.5 rounded-lg font-bold transition-all active:scale-[0.985]"
                >
                  {busy ? t('loading') : t('rebirth_confirm_button')}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-6 py-2.5 rounded-lg font-semibold transition-all active:scale-[0.985]"
                >
                  {t('rebirth_cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="bg-yellow-600 hover:bg-yellow-500 text-black px-6 py-2.5 rounded-lg font-bold transition-all active:scale-[0.985]"
            >
              👑 {t('rebirth_button')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
