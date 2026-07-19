'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from './PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';

type TargetStatus = {
  found: boolean;
  can_rip: boolean;
  reason: string;
  target_username: string;
  target_cash: number;
  target_dead: boolean;
  target_protected: boolean;
  cooldown_until: string | null;
};

export default function RipButton({ targetUsername }: { targetUsername: string }) {
  const { player, refreshPlayer, showToast } = usePlayer();
  const { t, language, fm } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TargetStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedRef = useRef(false);
  const supabase = createClient();

  const isSelf = player?.username && player.username === targetUsername;

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('get_rip_target_status', { target_username: targetUsername });
      if (data) setStatus(data as TargetStatus);
    } catch {
      // ignore status poll errors
    }
  }, [supabase, targetUsername]);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadStatus();
    }
    pollRef.current = setInterval(loadStatus, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [targetUsername, loadStatus]);

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
      const { data, error } = await supabase.rpc('rip_player', { target_username: targetUsername });
      if (error) {
        showToast(mapError(error.message), 'error');
        return;
      }
      if (data?.blocked) {
        showToast(t('rip_blocked', { target: data?.target ?? targetUsername }), 'fail');
      } else if (data?.success) {
        const amount = new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-US').format(Number(data.stolen));
        showToast(t('rip_success', { target: data.target, amount: fm(amount) }), 'success');
      } else {
        showToast(t('rip_fail', { target: data?.target ?? targetUsername }), 'fail');
      }
      if (refreshPlayer) await refreshPlayer();
      await router.refresh();
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const getTooltip = useCallback((): string => {
    if (!status) return t('rip_tooltip', { name: targetUsername });
    if (status.target_dead) return `${targetUsername} — DEAD`;
    if (status.target_protected) return `${targetUsername} — Protected`;
    if (status.reason === 'ON_COOLDOWN' && status.cooldown_until) {
      const cd = new Date(status.cooldown_until).getTime() - now;
      const secs = Math.max(0, Math.floor(cd / 1000));
      return `${targetUsername} — Cooldown ${secs}s`;
    }
    if (status.reason === 'TARGET_NO_CASH') return `${targetUsername} — Broke ($${status.target_cash})`;
    if (status.can_rip) return `${targetUsername} — Cash: $${fm(status.target_cash)}`;
    return `${targetUsername} — ${status.reason}`;
  }, [status, targetUsername, now, t, fm]);

  const getButtonColor = useCallback((): string => {
    if (!status) return 'bg-zinc-800 hover:bg-red-800';
    if (status.target_dead) return 'bg-zinc-700 text-zinc-500 cursor-not-allowed';
    if (status.target_protected) return 'bg-amber-900/50 text-amber-500 cursor-not-allowed';
    if (status.reason === 'ON_COOLDOWN') return 'bg-zinc-800 text-zinc-400';
    if (status.reason === 'TARGET_NO_CASH') return 'bg-zinc-800 text-zinc-500 cursor-not-allowed';
    if (status.can_rip) return 'bg-red-900 hover:bg-red-700 text-red-200';
    return 'bg-zinc-800 hover:bg-red-800';
  }, [status]);

  const isDisabled = busy || !status?.can_rip || status.target_dead || status.target_protected || status.reason === 'TARGET_NO_CASH';

  if (isSelf) return null;

  return (
    <button
      onClick={rip}
      disabled={isDisabled}
      title={getTooltip()}
      aria-label={getTooltip()}
      className={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors text-sm ${getButtonColor()}`}
    >
      {status?.target_dead ? '💀' : status?.target_protected ? '🛡️' : '🥷'}
    </button>
  );
}
