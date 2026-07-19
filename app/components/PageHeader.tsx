'use client';

import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  variant?: 'default' | 'danger' | 'premium' | 'weed' | 'cocaine' | 'meth' | 'property';
};

const variantStyles: Record<NonNullable<PageHeaderProps['variant']>, { border: string; bg: string; title: string; icon: string }> = {
  default: {
    border: 'border-zinc-700/60',
    bg: 'bg-gradient-to-b from-zinc-800/60 to-zinc-900/40',
    title: 'text-white',
    icon: 'text-amber-400',
  },
  danger: {
    border: 'border-red-900/60',
    bg: 'bg-gradient-to-b from-red-950/60 to-zinc-900/40',
    title: 'text-red-400',
    icon: 'text-red-300',
  },
  premium: {
    border: 'border-amber-700/60',
    bg: 'bg-gradient-to-b from-amber-950/60 to-zinc-900/40',
    title: 'text-amber-300',
    icon: 'text-amber-200',
  },
  weed: {
    border: 'border-emerald-900/60',
    bg: 'bg-gradient-to-b from-emerald-950/60 to-zinc-900/40',
    title: 'text-emerald-400',
    icon: 'text-emerald-300',
  },
  cocaine: {
    border: 'border-zinc-400/30',
    bg: 'bg-gradient-to-b from-zinc-100/10 to-zinc-900/40',
    title: 'text-zinc-200',
    icon: 'text-zinc-300',
  },
  meth: {
    border: 'border-blue-900/60',
    bg: 'bg-gradient-to-b from-blue-950/60 to-zinc-900/40',
    title: 'text-blue-400',
    icon: 'text-blue-300',
  },
  property: {
    border: 'border-orange-900/50',
    bg: 'bg-gradient-to-b from-orange-950/50 to-zinc-900/40',
    title: 'text-orange-400',
    icon: 'text-orange-300',
  },
};

export default function PageHeader({
  title,
  subtitle,
  icon,
  badge,
  actions,
  children,
  className = '',
  variant = 'default',
}: PageHeaderProps) {
  const style = variantStyles[variant];

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${style.border} ${style.bg} ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(245,158,11,0.06),transparent_45%)] pointer-events-none" />
      <div className="relative px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {icon && <span className={`text-xl sm:text-2xl ${style.icon}`}>{icon}</span>}
              <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${style.title}`}>{title}</h1>
              {badge}
            </div>
            {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}
