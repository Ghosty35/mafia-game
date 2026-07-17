'use client';

import { useEffect } from 'react';
import { usePlayer } from './PlayerContext';

const styles: Record<string, string> = {
  success: 'bg-green-950/95 border-green-700 text-green-200',
  fail: 'bg-red-950/95 border-red-700 text-red-200',
  error: 'bg-zinc-900/95 border-zinc-600 text-zinc-200',
  info: 'bg-zinc-900/95 border-zinc-700 text-zinc-200',
  levelup: 'bg-yellow-950/95 border-yellow-600 text-yellow-200',
};

// Always-visible action feedback: fixed to the top of the viewport so it
// shows up immediately no matter how far down the page you are (was
// previously easy to miss below the player header + trackers panel).
export default function Toast() {
  const { toast, dismissToast } = usePlayer();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 6000);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="fixed top-2 inset-x-0 z-[100] flex justify-center px-3 pointer-events-none">
      <div
        className={`pointer-events-auto max-w-xl w-full sm:w-auto border rounded-xl shadow-lg px-4 py-3 text-sm font-medium flex items-start gap-3 ${styles[toast.kind]}`}
      >
        <span className="flex-1">{toast.text}</span>
        <button
          onClick={dismissToast}
          className="shrink-0 opacity-70 hover:opacity-100 leading-none text-lg"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
