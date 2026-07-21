'use client';

import CityArt from './CityArt';

// Deterministic local SVG skyline art, keyed by city name - each of the 5
// cities has its own palette + distinct skyline silhouette. Previously
// fetched a random tag-matched "city+skyline" photo from loremflickr.com as
// the primary image with CityArt only as an onError fallback; a random
// photo tagged "miami+city+skyline" is not reliably Miami.
export default function CityImage({
  city,
  size = 96,
}: {
  city: string;
  size?: number;
}) {
  return <CityArt city={city} size={size} />;
}
