'use client';

import type { CSSProperties } from 'react';

// Procedurally drawn car SVG keyed by catalog_id. No external assets:
// each model gets a distinct body silhouette + a tier-based colour so the
// garage feels like a real showroom without needing licensed photography.

type Tier = 'default' | 'low' | 'mid' | 'luxury' | 'super' | 'hyper';

const TIER_COLOR: Record<Tier, { body: string; glass: string; glow: string }> = {
  default: { body: '#6b7280', glass: '#cbd5e1', glow: '#9ca3af' },
  low: { body: '#64748b', glass: '#bae6fd', glow: '#38bdf8' },
  mid: { body: '#475569', glass: '#a5f3fc', glow: '#22d3ee' },
  luxury: { body: '#3f3f46', glass: '#fef3c7', glow: '#facc15' },
  super: { body: '#27272a', glass: '#fecaca', glow: '#ef4444' },
  hyper: { body: '#18181b', glass: '#f5d0fe', glow: '#d946ef' },
};

// Body silhouette per body style; chosen from the catalog id.
function bodyStyle(id: string): 'sedan' | 'hatch' | 'suv' | 'sports' | 'exotic' {
  if (['old_sedan', 'honda_civic', 'toyota_corolla', 'ford_focus', 'vw_golf',
       'nissan_altima', 'lexus_is', 'mercedes_c', 'bmw_3', 'audi_a4', 'volvo_s60',
       'tesla_model3', 'mercedes_e', 'bmw_5', 'audi_a6', 'lexus_es', 'genesis_g80',
       'jaguar_xf', 'porsche_macan'].includes(id)) return 'sedan';
  if (['dacia_logan', 'hyundai_accent', 'kia_rio', 'nissan_versa',
       'chevrolet_spark', 'mazda3', 'subaru_impreza', 'skoda_octavia'].includes(id)) return 'hatch';
  if (['sports_car'].includes(id)) return 'sports';
  if (['porsche_911', 'audi_r8', 'mercedes_amg_gt', 'chevrolet_corvette',
       'nissan_gtr', 'bmw_m4', 'aston_vantage'].includes(id)) return 'exotic';
  return 'suv';
}

function tierOf(id: string): Tier {
  if (['bugatti_chiron','ferrari_sf90','lamborghini_huracan','mclaren_720s',
       'koenigsegg_jesko','pagani_huayra','rimac_nevera'].includes(id)) return 'hyper';
  if (['chevrolet_corvette','bmw_m4','nissan_gtr','porsche_911','mercedes_amg_gt',
       'audi_r8','aston_vantage'].includes(id)) return 'super';
  if (['mercedes_e','bmw_5','audi_a6','lexus_es','genesis_g80','jaguar_xf',
       'porsche_macan'].includes(id)) return 'luxury';
  if (['bmw_3','audi_a4','volvo_s60','tesla_model3','lexus_is','mercedes_c',
       'nissan_altima'].includes(id)) return 'mid';
  if (['honda_civic','toyota_corolla','ford_focus','vw_golf','mazda3',
       'subaru_impreza','skoda_octavia'].includes(id)) return 'low';
  return 'default';
}

function Body({ style, c }: { style: string; c: { body: string; glass: string } }) {
  switch (style) {
    case 'hatch':
      return (
        <path d="M14 52 q2 -16 22 -18 l34 -2 q14 0 20 14 l10 8 q6 4 6 12 l0 10 q0 4 -4 4 l-114 0 q-4 0 -4 -4 l0 -10 q0 -8 6 -12 z"
          fill={c.body} stroke="#0a0a0c" strokeWidth="2" />
      );
    case 'suv':
      return (
        <path d="M10 54 q0 -22 18 -24 l40 -2 q18 0 30 18 l12 8 q6 4 6 12 l0 8 q0 4 -4 4 l-102 0 q-4 0 -4 -4 l0 -8 q0 -8 4 -12 z"
          fill={c.body} stroke="#0a0a0c" strokeWidth="2" />
      );
    case 'sports':
    case 'exotic':
      return (
        <path d="M8 56 q4 -20 34 -22 l30 -1 q22 1 36 22 l8 6 q4 3 4 9 l0 6 q0 4 -4 4 l-112 0 q-4 0 -4 -4 l0 -6 q0 -6 4 -9 z"
          fill={c.body} stroke="#0a0a0c" strokeWidth="2" />
      );
    default: // sedan
      return (
        <path d="M10 54 q2 -18 24 -20 l30 -1 q16 0 26 14 l14 6 q6 4 6 12 l0 8 q0 4 -4 4 l-108 0 q-4 0 -4 -4 l0 -8 q0 -8 6 -12 z"
          fill={c.body} stroke="#0a0a0c" strokeWidth="2" />
      );
  }
}

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
      style={{ display: 'block', maxWidth: '100%', height: 'auto', filter: `drop-shadow(0 4px 10px ${col.glow}55)` } as CSSProperties}
    >
      {/* ground shadow */}
      <ellipse cx="70" cy="74" rx="56" ry="5" fill="#000" opacity="0.35" />
      {/* body */}
      <Body style={style} c={col} />
      {/* windows */}
      <path d="M40 38 q2 -8 16 -9 l20 -1 q8 0 12 8 l-2 8 l-46 0 z" fill={col.glass} opacity="0.85" />
      {tier !== 'default' && tier !== 'low' && (
        <path d="M86 38 l8 -6 q6 0 9 6 l-1 9 l-16 0 z" fill={col.glass} opacity="0.85" />
      )}
      {/* tuned accent stripe */}
      {tuned && <path d="M10 50 l120 0" stroke="#3b82f6" strokeWidth="2" opacity="0.8" />}
      {/* headlight */}
      <circle cx="126" cy="52" r="2.4" fill="#fde68a" />
      {/* wheels */}
      <circle cx="38" cy="66" r="11" fill={wheel} />
      <circle cx="38" cy="66" r="5" fill="#3f3f46" />
      <circle cx="104" cy="66" r="11" fill={wheel} />
      <circle cx="104" cy="66" r="5" fill="#3f3f46" />
    </svg>
  );
}
