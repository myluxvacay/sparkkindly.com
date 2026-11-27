// @vitest-environment node
// Phase 2.5 PWA surfaces that need no browser: the generated manifest's shape, the
// committed icon set's real dimensions, and — most importantly — the service worker's
// URL classification, extracted from the SERVED public/sw.js so the file that ships is
// the logic that is tested. The privacy boundary lives there: /family/, /account/,
// /admin/ and /api/ must classify network-only, or private circle data could be cached.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import manifest from '@/app/manifest';

describe('web app manifest', () => {
  const m = manifest();
  it('identifies SparkKindly and starts in the Family Hub, standalone', () => {
    expect(m.name).toBe('SparkKindly');
    expect(m.short_name).toBe('SparkKindly');
    expect(m.start_url).toBe('/family/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#5b2c6f');
    expect(m.background_color).toBe('#fffcf7');
  });
  it('offers 192 + 512 any icons and a maskable 512', () => {
    const icons = m.icons ?? [];
    const has = (sizes: string, purpose?: string) => icons.some((i) => i.sizes === sizes && (purpose === undefined || i.purpose === purpose));
    expect(has('192x192')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });
});

describe('committed PWA icons', () => {
  const dims = (file: string): { w: number; h: number } => {
    const b = readFileSync(file);
    expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };
  it('match their promised sizes', () => {
    expect(dims('public/icons/icon-192.png')).toEqual({ w: 192, h: 192 });
    expect(dims('public/icons/icon-512.png')).toEqual({ w: 512, h: 512 });
    expect(dims('public/icons/icon-maskable-512.png')).toEqual({ w: 512, h: 512 });
    expect(dims('public/icons/apple-touch-icon.png')).toEqual({ w: 180, h: 180 });
  });
});

describe('service worker', () => {
  const src = readFileSync('public/sw.js', 'utf8');
  const extract = (): ((pathname: string) => string) => {
    const start = src.indexOf('// [classify-start]');
    const end = src.indexOf('// [classify-end]');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    return new Function(`${body}; return classifyRequest;`)() as (pathname: string) => string;
  };

  it('classifies private surfaces network-only', () => {
    const classify = extract();
    for (const p of [
      '/family',
      '/family/',
      '/family/66c629b9/runs/',
      '/family/push/subscribe/',
      '/account/',
      '/account/sign-in/',
      '/admin/',
      '/api/agent/content',
      '/api/health',
      '/sw.js',
    ]) {
      expect(classify(p), p).toBe('network-only');
    }
  });

  it('classifies static assets cache-first and public pages network-first', () => {
    const classify = extract();
    for (const p of ['/_next/static/chunks/main.js', '/brand/icon-32.png', '/icons/icon-192.png', '/images/hero.jpg', '/fonts/inter.woff2', '/avatars/spark.svg']) {
      expect(classify(p), p).toBe('cache-first');
    }
    for (const p of ['/', '/play/', '/topics/animals/', '/kids/']) {
      expect(classify(p), p).toBe('network-first');
    }
  });

  it('never intercepts network-only requests and never stores a Set-Cookie response', () => {
    // The fetch handler returns before respondWith for network-only, and both caching
    // paths check for Set-Cookie before put(). These are source-level guards on the
    // served file; the classification matrix above is the behavioural half.
    expect(src).toContain("kind === 'network-only'");
    expect(src).toContain("res.headers.has('set-cookie')");
    expect(src).toContain('skipWaiting');
    expect(src).toContain('clients.claim');
  });
});
