'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import CityArt from './CityArt';

export default function CityImage({
  city,
  size = 96,
}: {
  city: string;
  size?: number;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return <CityArt city={city} size={size} />;
  }

  const keyword = city.toLowerCase().replace(/\s+/g, '+') + '+city+skyline';
  const src = `https://loremflickr.com/640/480/${keyword}?lock=${city}`;

  return (
    <img
      src={src}
      alt={city}
      loading="lazy"
      decoding="async"
      className="object-cover rounded"
      style={{ width: size, height: Math.round((size * 3) / 4), display: 'block' } as CSSProperties}
      onError={() => setError(true)}
    />
  );
}
