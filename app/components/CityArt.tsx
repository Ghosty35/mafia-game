'use client';

import type { CSSProperties, ReactElement } from 'react';

type CityKey = 'New York' | 'Chicago' | 'Los Angeles' | 'Miami' | 'Las Vegas';

type Palette = {
  sky: [string, string];
  ground: string;
  accent: string;
  window: string;
};

const PALETTE: Record<CityKey, Palette> = {
  'New York': {
    sky: ['#0b1020', '#1e293b'],
    ground: '#0a0a0c',
    accent: '#38bdf8',
    window: '#fde68a',
  },
  Chicago: {
    sky: ['#1a1320', '#2a1f3d'],
    ground: '#0a0a0c',
    accent: '#a78bfa',
    window: '#fbcfe8',
  },
  'Los Angeles': {
    sky: ['#2a1a10', '#7c2d12'],
    ground: '#1c1208',
    accent: '#fb923c',
    window: '#fef3c7',
  },
  Miami: {
    sky: ['#06222b', '#0e7490'],
    ground: '#08251f',
    accent: '#22d3ee',
    window: '#a7f3d0',
  },
  'Las Vegas': {
    sky: ['#1b0a2b', '#4c1d95'],
    ground: '#0c0518',
    accent: '#f472b6',
    window: '#fef08a',
  },
};

type Skyline = Array<{ x: number; w: number; h: number }>;

const SKYLINES: Record<CityKey, Skyline> = {
  'New York': [
    { x: 6, w: 16, h: 70 },
    { x: 24, w: 14, h: 120 },
    { x: 40, w: 18, h: 150 },
    { x: 60, w: 12, h: 90 },
    { x: 74, w: 16, h: 162 },
    { x: 92, w: 14, h: 110 },
    { x: 108, w: 16, h: 78 },
  ],
  Chicago: [
    { x: 8, w: 20, h: 96 },
    { x: 30, w: 16, h: 132 },
    { x: 48, w: 22, h: 108 },
    { x: 72, w: 14, h: 150 },
    { x: 88, w: 18, h: 84 },
    { x: 108, w: 18, h: 120 },
  ],
  'Los Angeles': [
    { x: 6, w: 24, h: 56 },
    { x: 32, w: 20, h: 88 },
    { x: 54, w: 26, h: 64 },
    { x: 82, w: 18, h: 100 },
    { x: 102, w: 24, h: 48 },
  ],
  Miami: [
    { x: 8, w: 18, h: 110 },
    { x: 28, w: 14, h: 140 },
    { x: 44, w: 20, h: 84 },
    { x: 66, w: 16, h: 128 },
    { x: 84, w: 22, h: 70 },
    { x: 108, w: 16, h: 96 },
  ],
  'Las Vegas': [
    { x: 10, w: 16, h: 96 },
    { x: 28, w: 14, h: 150 },
    { x: 44, w: 22, h: 70 },
    { x: 68, w: 16, h: 132 },
    { x: 86, w: 18, h: 88 },
    { x: 106, w: 22, h: 116 },
  ],
};

function keyOf(city: string): CityKey {
  return (city as CityKey) in PALETTE ? (city as CityKey) : 'New York';
}

function windowDots(x: number, y: number, w: number, h: number, color: string) {
  const cols = Math.max(2, Math.floor(w / 7));
  const rows = Math.max(3, Math.floor(h / 14));
  const dotW = w / cols;
  const dotH = h / rows;
  const dots: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r * 7 + c * 3) % 5 === 0) continue;
      dots.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * dotW + dotW * 0.28}
          y={y + r * dotH + dotH * 0.28}
          width={dotW * 0.44}
          height={dotH * 0.44}
          fill={color}
          opacity={0.85}
          rx={0.5}
        />
      );
    }
  }
  return dots;
}

export default function CityArt({
  city,
  size = 96,
}: {
  city: string;
  size?: number;
}) {
  const key = keyOf(city);
  const pal = PALETTE[key];
  const buildings = SKYLINES[key];
  const W = 132;
  const H = 180;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={Math.round((size * H) / W)}
      role="img"
      aria-label={city}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' } as CSSProperties}
    >
      <defs>
        <linearGradient id={`city-sky-${key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.sky[0]} />
          <stop offset="100%" stopColor={pal.sky[1]} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill={`url(#city-sky-${key})`} />
      <circle cx={W - 22} cy="22" r="10" fill={pal.accent} opacity="0.55" />
      <rect x="0" y="158" width={W} height={H - 158} fill={pal.ground} />
      {buildings.map((b, i) => {
        const y = H - b.h - 22;
        return (
          <g key={i}>
            <rect
              x={b.x}
              y={y}
              width={b.w}
              height={b.h}
              fill="#0c0c10"
              stroke={pal.accent}
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            {windowDots(b.x + 2, y + 4, b.w - 4, b.h - 8, pal.window)}
          </g>
        );
      })}
      <rect x="0" y="156" width={W} height="3" fill={pal.accent} opacity="0.5" />
    </svg>
  );
}
