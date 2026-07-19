'use client';

import type { CSSProperties } from 'react';

type Tier = 'default' | 'low' | 'mid' | 'luxury' | 'super' | 'hyper';

const TIER_COLOR: Record<Tier, { body: string; glass: string; glow: string; trim: string }> = {
  default: { body: '#52525b', glass: '#cbd5e1', glow: '#9ca3af', trim: '#3f3f46' },
  low:     { body: '#475569', glass: '#bae6fd', glow: '#38bdf8', trim: '#334155' },
  mid:     { body: '#3f3f46', glass: '#a5f3fc', glow: '#22d3ee', trim: '#27272a' },
  luxury:  { body: '#292524', glass: '#fef3c7', glow: '#facc15', trim: '#1c1917' },
  super:   { body: '#1c1917', glass: '#fecaca', glow: '#ef4444', trim: '#0c0a09' },
  hyper:   { body: '#0f0f10', glass: '#f5d0fe', glow: '#d946ef', trim: '#050505' },
};

type BodyStyle = 'sedan' | 'hatch' | 'suv' | 'sports' | 'exotic';

function bodyStyle(id: string): BodyStyle {
  const hatch = ['dacia_logan','hyundai_accent','kia_rio','nissan_versa','chevrolet_spark','mazda3','subaru_impreza','skoda_octavia'];
  const exotic = ['porsche_911','audi_r8','mercedes_amg_gt','chevrolet_corvette','nissan_gtr','bmw_m4','aston_vantage'];
  if (hatch.includes(id)) return 'hatch';
  if (exotic.includes(id)) return 'exotic';
  if (id === 'sports_car') return 'sports';
  return 'sedan';
}

function tierOf(id: string): Tier {
  const hyper = ['bugatti_chiron','ferrari_sf90','lamborghini_huracan','mclaren_720s','koenigsegg_jesko','pagani_huayra','rimac_nevera'];
  const superTier = ['chevrolet_corvette','bmw_m4','nissan_gtr','porsche_911','mercedes_amg_gt','audi_r8','aston_vantage'];
  const luxury = ['mercedes_e','bmw_5','audi_a6','lexus_es','genesis_g80','jaguar_xf','porsche_macan'];
  const mid = ['bmw_3','audi_a4','volvo_s60','tesla_model3','lexus_is','mercedes_c','nissan_altima'];
  const low = ['honda_civic','toyota_corolla','ford_focus','vw_golf','mazda3','subaru_impreza','skoda_octavia'];
  if (hyper.includes(id)) return 'hyper';
  if (superTier.includes(id)) return 'super';
  if (luxury.includes(id)) return 'luxury';
  if (mid.includes(id)) return 'mid';
  if (low.includes(id)) return 'low';
  return 'default';
}

const BODY: Record<BodyStyle, string> = {
  sedan:
    'M10 54 q2 -18 24 -20 l30 -1 q16 0 26 14 l14 6 q6 4 6 12 l0 8 q0 4 -4 4 l-108 0 q-4 0 -4 -4 l0 -8 q0 -8 6 -12 z',
  hatch:
    'M14 52 q2 -16 22 -18 l34 -2 q14 0 20 14 l10 8 q6 4 6 12 l0 10 q0 4 -4 4 l-114 0 q-4 0 -4 -4 l0 -10 q0 -8 6 -12 z',
  suv:
    'M10 54 q0 -22 18 -24 l40 -2 q18 0 30 18 l12 8 q6 4 6 12 l0 8 q0 4 -4 4 l-102 0 q-4 0 -4 -4 l0 -8 q0 -8 4 -12 z',
  sports:
    'M8 56 q4 -20 34 -22 l30 -1 q22 1 36 22 l8 6 q4 3 4 9 l0 6 q0 4 -4 4 l-112 0 q-4 0 -4 -4 l0 -6 q0 -6 4 -9 z',
  exotic:
    'M6 56 q6 -22 40 -24 l28 -1 q26 0 38 24 l6 4 q4 2 4 8 l0 6 q0 4 -4 4 l-118 0 q-4 0 -4 -4 l0 -6 q0 -6 4 -8 z',
};

export default function CarArt({
  catalogId,
  tuned = false,
  size = 96,
}: {
  catalogId: string;
  tuned?: boolean;
  size?: number;
}) {
  const tier = tierOf(catalogId);
  const style = bodyStyle(catalogId);
  const col = TIER_COLOR[tier];
  const wheel = '#0a0a0c';

  return (
    <svg
      viewBox="0 0 140 80"
      width={size}
      height={(size * 80) / 140}
      role="img"
      aria-label={catalogId}
      style={{ display: 'block', maxWidth: '100%', height: 'auto', filter: `drop-shadow(0 6px 14px ${col.glow}66)` } as CSSProperties}
    >
      <defs>
        <linearGradient id={`grad-${catalogId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col.body} stopOpacity="1" />
          <stop offset="100%" stopColor={col.trim} stopOpacity="1" />
        </linearGradient>
      </defs>
      <ellipse cx="70" cy="74" rx="56" ry="5" fill="#000" opacity="0.35" />
      <path d={BODY[style]} fill={`url(#grad-${catalogId})`} stroke="#0a0a0c" strokeWidth="2" />
      <path d="M40 38 q2 -8 16 -9 l20 -1 q8 0 12 8 l-2 8 l-46 0 z" fill={col.glass} opacity="0.85" />
      {tier !== 'default' && tier !== 'low' && (
        <path d="M86 38 l8 -6 q6 0 9 6 l-1 9 l-16 0 z" fill={col.glass} opacity="0.85" />
      )}
      {tuned && <path d="M10 50 l120 0" stroke="#3b82f6" strokeWidth="2.5" opacity="0.9" />}
      <circle cx="126" cy="52" r="2.4" fill="#fde68a" />
      <circle cx="38" cy="66" r="11" fill={wheel} />
      <circle cx="38" cy="66" r="5" fill="#3f3f46" />
      <circle cx="104" cy="66" r="11" fill={wheel} />
      <circle cx="104" cy="66" r="5" fill="#3f3f46" />
      {tier === 'hyper' && (
        <path d="M20 44 q30 -6 100 -2" stroke={col.glow} strokeWidth="1.5" opacity="0.4" fill="none" />
      )}
    </svg>
  );
}
