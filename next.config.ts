import type { NextConfig } from 'next';
// Standalone server build: the deploy ships .next/standalone (+ .next/static and public) as one release.
const config: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
};
export default config;
