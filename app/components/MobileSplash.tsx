'use client';

import { useEffect, useState } from 'react';

export default function MobileSplash() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show once per session
    if (typeof window !== 'undefined' && sessionStorage.getItem('splash-seen')) {
      return;
    }

    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      sessionStorage.setItem('splash-seen', '1');
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 flex items-center justify-center pointer-events-none">
      <div className="text-center px-6">
        <div className="text-5xl mb-3 animate-bounce">♛</div>
        <h1 className="text-xl font-black tracking-tight mb-1">
          <span className="text-red-600">HUSTLER&apos;S</span>
          <span className="text-white">WAY</span>
        </h1>
        <p className="text-[10px] text-zinc-500 tracking-widest uppercase">Loading...</p>
      </div>
    </div>
  );
}
