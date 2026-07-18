'use client';

import { useCallback, useRef, useState } from 'react';

// Client-side backstop against autoclickers / macro scripts. The server is the
// real authority (commit_crime enforces a minimum interval via last_action_at),
// but this guard keeps the button disabled between clicks so a bot can't even
// spam the network, and gives immediate local feedback.
//
// The lock is time-based AND count-based (a human can't click meaningfully more
// than ~3x/sec; anything faster is almost certainly a script). The lock releases
// shortly after the server's minimum interval so legit players feel nothing.
export function useActionLock(minIntervalMs = 1200) {
  const lastFire = useRef<number>(0);
  const rapidClicks = useRef<number>(0);
  const rapidWindowStart = useRef<number>(0);
  const [locked, setLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);

  const guard = useCallback(
    (now = Date.now()): boolean => {
      // Rapid-burst detection: more than 5 clicks inside 1.5s trips the lock.
      if (now - rapidWindowStart.current > 1500) {
        rapidWindowStart.current = now;
        rapidClicks.current = 0;
      }
      rapidClicks.current += 1;
      if (rapidClicks.current > 5) {
        const until = now + 4000;
        setLockUntil(until);
        setLocked(true);
        setTimeout(() => setLocked(false), until - Date.now());
        return true; // blocked
      }

      if (now - lastFire.current < minIntervalMs) {
        const until = lastFire.current + minIntervalMs;
        setLockUntil(until);
        setLocked(true);
        setTimeout(() => setLocked(false), until - Date.now());
        return true; // blocked
      }

      lastFire.current = now;
      return false; // allowed
    },
    [minIntervalMs]
  );

  return { guard, locked, lockUntil };
}

// Map a server error to a localized-friendly client message key.
export function isTooFastError(message?: string): boolean {
  return !!message && message.includes('TOO_FAST');
}
