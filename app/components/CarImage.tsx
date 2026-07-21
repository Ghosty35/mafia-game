'use client';

import CarArt from './CarArt';

// Deterministic local SVG art, keyed by catalog id (tier + body style
// resolved internally) - guaranteed to match the car's actual class.
// Previously fetched a random tag-matched photo from loremflickr.com as the
// primary image with CarArt only as an onError fallback; a random Flickr
// photo tagged "bmw+3+series" is not reliably even a BMW.
export default function CarImage({
  catalogId,
  tuned = false,
  size = 96,
}: {
  catalogId: string;
  name?: string;
  tuned?: boolean;
  size?: number;
}) {
  return <CarArt catalogId={catalogId} tuned={tuned} size={size} />;
}
