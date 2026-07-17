'use client';

import type { ReactNode } from 'react';

// Bulletstar-style boxed panel: a titled header bar above the content.
// Shared by the Phase 3 page redesigns so every page frames its sections
// the same way.
export default function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 bg-zinc-950/70 border-b border-zinc-800 px-4 py-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[2px] text-amber-400 truncate">
          {icon && <span className="mr-1.5">{icon}</span>}
          {title}
        </h2>
        {actions}
      </div>
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  );
}
