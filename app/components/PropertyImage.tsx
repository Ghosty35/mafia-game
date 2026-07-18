'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import PropertyArt from './PropertyArt';

const KEYWORDS: Record<string, string> = {
  house: 'house',
  villa: 'villa',
  mansion: 'mansion',
  agency: 'office+building',
  airport: 'airport',
  casino: 'casino',
  tuneshop: 'car+repair+shop',
  redlight: 'city+night',
};

export default function PropertyImage({
  catalogId,
  ptype,
  name,
  size = 96,
}: {
  catalogId: string;
  ptype?: string;
  name?: string;
  size?: number;
}) {
  const [error, setError] = useState(false);
  const type = (ptype || 'agency') as keyof typeof KEYWORDS;
  const keyword = KEYWORDS[type] || 'building';

  if (error) {
    return <PropertyArt catalogId={catalogId} ptype={ptype} size={size} />;
  }

  const src = `https://loremflickr.com/640/480/${keyword}?lock=${catalogId}`;

  return (
    <img
      src={src}
      alt={name || catalogId}
      loading="lazy"
      decoding="async"
      className="object-cover rounded"
      style={{ width: size, height: Math.round((size * 3) / 4), display: 'block' } as CSSProperties}
      onError={() => setError(true)}
    />
  );
}
