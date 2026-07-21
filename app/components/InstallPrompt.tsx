'use client';

import { useEffect, useState } from 'react';

// The `beforeinstallprompt` event isn't in the standard DOM lib types.
interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
      if ('userChoice' in (e as PromptEvent)) {
        window.deferredPWAInstall = {
          prompt: async () => (e as PromptEvent).prompt(),
          userChoice: (e as PromptEvent).userChoice,
        };
      }
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt as PromptEvent;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-zinc-900 border border-amber-800/50 rounded-xl p-4 shadow-2xl z-50">
      <div className="flex items-start gap-3">
        <div className="text-3xl">♛</div>
        <div className="flex-1">
          <h3 className="font-bold text-sm text-white">Install A Hustler&apos;s Way</h3>
          <p className="text-xs text-zinc-400 mt-1">
            Add to home screen for quick access and a fullscreen app-like experience.
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleInstall}
          className="flex-1 px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-bold transition-colors"
        >
          Install
        </button>
        <button
          onClick={() => setShowPrompt(false)}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-semibold transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
