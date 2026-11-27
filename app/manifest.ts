import type { MetadataRoute } from 'next';

// Web app manifest (Phase 2.5 PWA, 27 Nov 2026): SparkKindly installs to the home screen
// and opens straight into the Family Hub. Icons are generated from the owner's 1024px
// app icon by scripts/generate-pwa-icons.ts. Colours are the site's brand palette
// (app/globals.css: --plum / --paper).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SparkKindly',
    short_name: 'SparkKindly',
    description: 'Think sharp. Be kind. Your family hub: schedule, runs, chores and meals.',
    start_url: '/family/',
    scope: '/',
    display: 'standalone',
    background_color: '#fffcf7',
    theme_color: '#5b2c6f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
