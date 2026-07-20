import type { MetadataRoute } from 'next';

// Web App Manifest so the game can be installed on a phone home screen
// (PWA) — the first step toward the future mobile app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "A Hustler's Way",
    short_name: "Hustler's Way",
    description:
      'A modern mafia browser game. Rise through the ranks, rule the city.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
}
