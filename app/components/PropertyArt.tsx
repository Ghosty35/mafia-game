'use client';

import type { CSSProperties } from 'react';

type PType = 'house' | 'villa' | 'mansion' | 'agency' | 'airport' | 'casino' | 'tuneshop' | 'redlight';

const PCOLOR: Record<PType, { body: string; roof: string; glass: string; glow: string }> = {
  house:    { body: '#78716c', roof: '#57534e', glass: '#fde68a', glow: '#fbbf24' },
  villa:    { body: '#a8a29e', roof: '#78716c', glass: '#fef3c7', glow: '#f59e0b' },
  mansion:  { body: '#44403c', roof: '#292524', glass: '#fef9c3', glow: '#eab308' },
  agency:   { body: '#52525b', roof: '#3f3f46', glass: '#cbd5e1', glow: '#94a3b8' },
  airport:  { body: '#e7e5e4', roof: '#a8a29e', glass: '#bae6fd', glow: '#38bdf8' },
  casino:   { body: '#7f1d1d', roof: '#450a0a', glass: '#fecaca', glow: '#ef4444' },
  tuneshop: { body: '#7c2d12', roof: '#431407', glass: '#fed7aa', glow: '#f97316' },
  redlight: { body: '#831843', roof: '#500724', glass: '#fbcfe8', glow: '#ec4899' },
};

function ptypeOf(id: string, ptype?: string): PType {
  if (ptype && ptype in PCOLOR) return ptype as PType;
  const n = id.toLowerCase();
  if (n.includes('mansion')) return 'mansion';
  if (n.includes('villa')) return 'villa';
  if (n.includes('house')) return 'house';
  if (n.includes('airport')) return 'airport';
  if (n.includes('roulette') || n.includes('blackjack') || n.includes('numbers') || n.includes('fruit')) return 'casino';
  if (n.includes('tuneshop')) return 'tuneshop';
  if (n.includes('red') || n.includes('rld')) return 'redlight';
  if (n.includes('detective')) return 'agency';
  if (n.includes('hospital')) return 'agency';
  if (n.includes('bank') || n.includes('factory')) return 'agency';
  return 'agency';
}

const SHAPES: Record<PType, string> = {
  house: 'M10 54 l10 -18 l10 0 l10 -12 l10 0 l10 -10 l10 0 l10 18 z M10 54 l100 0',
  villa: 'M8 54 l8 -20 l12 0 l12 -14 l12 0 l12 -12 l12 0 l12 20 z M8 54 l108 0',
  mansion: 'M6 54 l8 -24 l14 0 l10 -14 l12 0 l12 -12 l10 0 l14 14 l6 0 l6 24 z M6 54 l114 0',
  agency: 'M10 54 l0 -30 l40 0 l0 16 l20 0 l0 -16 l40 0 l0 30 z M10 54 l120 0',
  airport: 'M20 54 l0 -20 l10 0 l20 14 l20 -14 l20 0 l10 0 l0 20 z M20 54 l100 0',
  casino: 'M10 54 l0 -26 l50 0 l0 14 l20 0 l0 -14 l50 0 l0 26 z M10 54 l120 0',
  tuneshop: 'M10 54 l0 -22 l30 0 l10 10 l20 0 l10 -10 l30 0 l0 22 z M10 54 l110 0',
  redlight: 'M10 54 l0 -20 l10 0 l10 -8 l10 0 l10 -6 l10 0 l10 -6 l10 0 l10 -8 l10 0 l10 20 z M10 54 l110 0',
};

export default function PropertyArt({
  catalogId,
  ptype,
  size = 96,
}: {
  catalogId: string;
  ptype?: string;
  size?: number;
}) {
  const type = ptypeOf(catalogId, ptype);
  const col = PCOLOR[type];
  const h = size;
  const w = Math.round(size * 1.35);
  const bodyD = SHAPES[type];

  return (
    <svg
      viewBox="0 0 140 80"
      width={w}
      height={h}
      role="img"
      aria-label={catalogId}
      style={{ display: 'block', maxWidth: '100%', height: 'auto', filter: `drop-shadow(0 6px 14px ${col.glow}55)` } as CSSProperties}
    >
      <defs>
        <linearGradient id={`pgrad-${catalogId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col.body} />
          <stop offset="100%" stopColor={col.roof} />
        </linearGradient>
      </defs>
      <ellipse cx="70" cy="74" rx="56" ry="5" fill="#000" opacity="0.35" />
      <path d={bodyD} fill={`url(#pgrad-${catalogId})`} stroke="#0a0a0c" strokeWidth="2" />
      <rect x="20" y="34" width="14" height="18" rx="1" fill={col.glass} opacity="0.85" />
      <rect x="44" y="34" width="14" height="18" rx="1" fill={col.glass} opacity="0.85" />
      <rect x="82" y="34" width="14" height="18" rx="1" fill={col.glass} opacity="0.85" />
      <rect x="106" y="34" width="14" height="18" rx="1" fill={col.glass} opacity="0.85" />
      {type === 'casino' && (
        <path d="M62 14 l8 -6 q6 0 8 6 l-1 9 l-16 0 z" fill={col.glow} opacity="0.9" />
      )}
      {type === 'airport' && (
        <path d="M60 10 l20 0 l-8 8 l8 6 l-16 0 l-8 -6 z" fill={col.glow} opacity="0.9" />
      )}
      {type === 'redlight' && (
        <circle cx="70" cy="28" r="3" fill="#f43f5e" opacity="0.95" />
      )}
      {type === 'tuneshop' && (
        <rect x="60" y="22" width="20" height="10" rx="2" fill={col.glow} opacity="0.8" />
      )}
    </svg>
  );
}
