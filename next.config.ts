import type { NextConfig } from 'next';
// Standalone server build: the deploy ships .next/standalone (+ .next/static and public) as one release.
const config: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  // Invite pages (plan 4B): never cached, and the token in the URL never leaves in a Referer.
  async headers() {
    return [
      {
        source: '/circles/join/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};
export default config;
