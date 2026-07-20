'use client';

import { useEffect, useState } from 'react';

export default function PWAInstallBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isAppleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(isAppleDevice);

    const dismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (dismissed) return;

    const deferredPrompt = window.deferredPWAInstall;
    if (deferredPrompt) {
      setTimeout(() => setShowBanner(true), 3000);
    }
  }, []);

  const handleDismiss = () => {
    setShowBanner(false);
    sessionStorage.setItem('pwa-banner-dismissed', 'true');
  };

  const handleInstall = async () => {
    const deferredPrompt = window.deferredPWAInstall;
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    window.deferredPWAInstall = undefined;
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-zinc-900 border border-amber-800/50 rounded-xl p-4 shadow-2xl z-50 animate-slideIn">
      <div className="flex items-start gap-3">
        <div className="text-3xl shrink-0">♛</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm text-white">Install A Hustler's Way</h3>
          <p className="text-xs text-zinc-400 mt-1">
            {isIOS 
              ? 'Tap Share → "Add to Home Screen" to install this app.'
              : 'Install this app on your home screen for quick access and a fullscreen experience.'
            }
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-zinc-500 hover:text-zinc-300 text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {!isIOS && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleInstall}
            className="flex-1 px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-bold transition-colors"
          >
            Install App
          </button>
          <button
            onClick={handleDismiss}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-semibold transition-colors"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
