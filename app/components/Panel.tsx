'use client';

import type { ReactNode } from 'react';

// Mafia-themed panel system with variants for different contexts.
// Variants: default | premium | danger | weed | cocaine | meth | property
export default function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  variant = 'default',
}: {
  title: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  variant?: 'default' | 'premium' | 'danger' | 'weed' | 'cocaine' | 'meth' | 'property';
}) {
  const variantStyles = {
    default: {
      card: 'bg-zinc-900 border border-zinc-800',
      header: 'bg-zinc-950/70 border-b border-zinc-800',
      title: 'text-amber-400',
    },
    premium: {
      card: 'bg-zinc-900 border border-amber-700/50 shadow-[0_0_20px_rgba(245,158,11,0.08)]',
      header: 'bg-gradient-to-r from-amber-950/80 to-zinc-950 border-b border-amber-800/50',
      title: 'text-amber-300',
    },
    danger: {
      card: 'bg-zinc-900 border border-red-900/50',
      header: 'bg-red-950/30 border-b border-red-900/50',
      title: 'text-red-400',
    },
    weed: {
      card: 'bg-zinc-900 border border-emerald-900/50',
      header: 'bg-emerald-950/30 border-b border-emerald-900/50',
      title: 'text-emerald-400',
    },
    cocaine: {
      card: 'bg-zinc-900 border border-zinc-400/30',
      header: 'bg-zinc-100/5 border-b border-zinc-400/30',
      title: 'text-zinc-200',
    },
    meth: {
      card: 'bg-zinc-900 border border-blue-900/50',
      header: 'bg-blue-950/30 border-b border-blue-900/50',
      title: 'text-blue-400',
    },
    property: {
      card: 'bg-zinc-900 border border-orange-900/40',
      header: 'bg-orange-950/20 border-b border-orange-900/40',
      title: 'text-orange-400',
    },
  };

  const style = variantStyles[variant];

  return (
    <section className={`${style.card} rounded-xl overflow-hidden ${className ?? ''}`}>
      <div className={`flex items-center justify-between gap-2 ${style.header} px-4 py-2.5`}>
        <h2 className={`text-[11px] font-bold uppercase tracking-[2px] truncate ${style.title}`}>
          {icon && <span className="mr-1.5">{icon}</span>}
          {title}
        </h2>
        {actions}
      </div>
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  );
}
