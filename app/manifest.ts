import type { MetadataRoute } from 'next';

// Web App Manifest so the game can be installed on a phone home screen
// (PWA) — the first step toward the future mobile app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: "A Hustler's Way",
    short_name: "Hustler's Way",
    description:
      'A modern mafia browser game. Rise through the ranks, rule the city.',
    lang: 'en',
    dir: 'ltr',
    categories: ['games', 'entertainment'],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      // Split "any" and "maskable" into separate entries: a single icon flagged
      // as both makes Android crop the un-padded art on the home screen.
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
