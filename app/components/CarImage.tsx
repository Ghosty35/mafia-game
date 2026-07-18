'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import CarArt from './CarArt';

const KEYWORDS: Record<string, string> = {
  old_sedan: 'classic+car',
  honda_civic: 'honda+civic',
  toyota_corolla: 'toyota+corolla',
  ford_focus: 'ford+focus',
  vw_golf: 'volkswagen+golf',
  nissan_altima: 'nissan+altima',
  lexus_is: 'lexus+is',
  mercedes_c: 'mercedes+c-class',
  bmw_3: 'bmw+3+series',
  audi_a4: 'audi+a4',
  volvo_s60: 'volvo+s60',
  tesla_model3: 'tesla+model+3',
  mercedes_e: 'mercedes+e-class',
  bmw_5: 'bmw+5+series',
  audi_a6: 'audi+a6',
  lexus_es: 'lexus+es',
  genesis_g80: 'genesis+g80',
  jaguar_xf: 'jaguar+xf',
  porsche_macan: 'porsche+macan',
  dacia_logan: 'dacia+logan',
  hyundai_accent: 'hyundai+accent',
  kia_rio: 'kia+rio',
  nissan_versa: 'nissan+versa',
  chevrolet_spark: 'chevrolet+spark',
  mazda3: 'mazda+3',
  subaru_impreza: 'subaru+impreza',
  skoda_octavia: 'skoda+octavia',
  sports_car: 'sports+car',
  porsche_911: 'porsche+911',
  audi_r8: 'audi+r8',
  mercedes_amg_gt: 'mercedes+amg+gt',
  chevrolet_corvette: 'chevrolet+corvette',
  nissan_gtr: 'nissan+gt-r',
  bmw_m4: 'bmw+m4',
  aston_vantage: 'aston+martin+vantage',
  lamborghini_huracan: 'lamborghini+huracan',
  ferrari_sf90: 'ferrari+sf90',
  mclaren_720s: 'mclaren+720s',
  pagani_huayra: 'pagani+huayra',
  bugatti_chiron: 'bugatti+chiron',
  koenigsegg_jesko: 'koenigsegg+jesko',
  rimac_nevera: 'rimac+nevera',
};

export default function CarImage({
  catalogId,
  name,
  tuned = false,
  size = 96,
}: {
  catalogId: string;
  name?: string;
  tuned?: boolean;
  size?: number;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return <CarArt catalogId={catalogId} tuned={tuned} size={size} />;
  }

  const keyword = KEYWORDS[catalogId] || catalogId.replace(/_/g, '+');
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
