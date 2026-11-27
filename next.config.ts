import type { NextConfig } from 'next';
// Standalone server build: the deploy ships .next/standalone (+ .next/static and public) as one release.
const config: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  // /sponsors/ was cited in sponsor outreach before the page settled at /sponsorship/; keep the cited URL working.
  async redirects() {
    return [{ source: '/sponsors', destination: '/sponsorship/', permanent: true }];
  },
  // Invite pages (plan 4B): never cached, and the token in the URL never leaves in a Referer.
  async headers() {
    return [
      // Service worker (Phase 2.5): the browser must re-check for a new worker on every
      // visit, or a fixed worker would take a day to reach installed devices.
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        source: '/circles/join/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // "Never email me invites again" (4B review): the signed token in the URL never leaves in a Referer either.
      {
        source: '/circles/stop-invites/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // Appeal links (plan 7B): a signed token in the URL; never cached, never sent on in a Referer.
      {
        source: '/comments/appeal/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};
export default config;
