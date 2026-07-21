'use client';

import PropertyArt from './PropertyArt';

// Deterministic local SVG art, keyed by property type - guaranteed to match
// what it's labeling (a house always looks like a house). Previously this
// fetched a random tag-matched photo from loremflickr.com as the primary
// image with PropertyArt only as an onError fallback; a "random Flickr
// photo loosely tagged 'villa'" is not reliably a villa, which is exactly
// the mismatched/sloppy look this replaces.
export default function PropertyImage({
  catalogId,
  ptype,
  size = 96,
}: {
  catalogId: string;
  ptype?: string;
  name?: string;
  size?: number;
}) {
  return <PropertyArt catalogId={catalogId} ptype={ptype} size={size} />;
}
