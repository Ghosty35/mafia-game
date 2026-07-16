'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// The "poppetje" action at the end of each leaderboard row: rob (rip) a
// player's cash-on-hand. Server-authoritative via rip_player(target).
export default function RipButton({ targetUsername }: { targetUsername: string }) {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState(false);

  // Never show a rip button against yourself.
  if (player?.username && player.username === targetUsername) return null;

  const mapError = (msg: string): string => {
    if (msg.includes('ON_COOLDOWN')) return t('rip_err_cooldown', { target: targetUsername });
    if (msg.includes('TARGET_NO_CASH')) return t('rip_err_no_cash', { target: targetUsername });
    if (msg.includes('IN_JAIL')) return t('rip_err_in_jail');
    if (msg.includes('DEAD') && !msg.includes('TARGET_DEAD')) return t('rip_err_dead');
    if (msg.includes('TARGET_PROTECTED')) return t('rip_err_protected', { target: targetUsername });
    if (msg.includes('TARGET_DEAD')) return t('rip_err_target_dead', { target: targetUsername });
    if (msg.includes('CANNOT_TARGET_SELF')) return t('rip_err_self');
    if (msg.includes('NOT_ENOUGH_STAMINA')) return t('error_no_stamina');
    return t('rip_err_generic', { msg });
  };

  const rip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('rip_player', { target_username: targetUsername });
      if (error) {
        showToast(mapError(error.message), 'error');
        return;
      }
      if (data?.success) {
        const amount = new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Number(data.stolen));
        showToast(t('rip_success', { target: data.target, amount: `$${amount}` }), 'success');
      } else {
        showToast(t('rip_fail', { target: data?.target ?? targetUsername }), 'fail');
      }
      if (refreshPlayer) await refreshPlayer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={rip}
      disabled={busy}
      title={t('rip_tooltip', { name: targetUsername })}
      aria-label={t('rip_tooltip', { name: targetUsername })}
      className="inline-flex items-center justify-center w-7 h-7 rounded bg-zinc-800 hover:bg-red-800 disabled:opacity-40 transition-colors text-sm"
    >
      🥷
    </button>
  );
}
