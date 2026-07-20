'use client';

import { useEffect, useState } from 'react';

export default function MobileSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4 animate-bounce">♛</div>
        <h1 className="text-2xl font-black tracking-tight mb-2">
          <span className="text-red-600">HUSTLER&apos;S</span>
          <span className="text-white">WAY</span>
        </h1>
        <p className="text-xs text-zinc-500 tracking-widest uppercase">Loading...</p>
      </div>
    </div>
  );
}
