// SEO audit (H2, L1, L2, L3, L4): page metadata from lib/seo.tsx and the layout. The home title is absolute (no
// template), og:locale is en_GB, a released indexable page allows large image previews, and the layout sets no robots
// meta of its own on a released build (so a not-found page carries only Next's noindex).
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(release: 'true' | 'false') {
  vi.resetModules();
  vi.stubEnv('SITE_RELEASE', release);
  return import('@/lib/seo');
}

describe('seo()', () => {
  it('uses the layout template by default and an absolute title on request, og:title too', async () => {
    const { metadata } = await load('true');
    expect(metadata('About', 'd', '/about/').title).toBe('About');
    const home = metadata('SparkKindly — Think sharp. Be kind.', 'd', '/', { absoluteTitle: true });
    expect(home.title).toEqual({ absolute: 'SparkKindly — Think sharp. Be kind.' });
    expect(home.openGraph?.title).toBe('SparkKindly — Think sharp. Be kind.');
  });

  it('sets og:locale en_GB', async () => {
    const { metadata } = await load('true');
    expect(metadata('T', 'd', '/x/').openGraph).toMatchObject({ locale: 'en_GB' });
  });

  it('released: index, follow and max-image-preview large; preview: noindex, nofollow without it', async () => {
    expect((await load('true')).metadata('T', 'd', '/x/').robots).toEqual({ index: true, follow: true, 'max-image-preview': 'large' });
    expect((await load('false')).metadata('T', 'd', '/x/').robots).toEqual({ index: false, follow: false });
  });
});

describe('pages', () => {
  it('home reads "SparkKindly — Think sharp. Be kind." as an absolute title; about is "About" (the template adds the brand)', async () => {
    vi.stubEnv('SITE_RELEASE', 'true');
    const home = (await import('@/app/page')).metadata;
    expect(home.title).toEqual({ absolute: 'SparkKindly — Think sharp. Be kind.' });
    const about = (await import('@/app/(trust)/about/page')).metadata;
    expect(about.title).toBe('About');
  });

  it('the released layout emits no robots meta (not-found pages get only noindex); the preview layout keeps noindex', async () => {
    vi.stubEnv('SITE_RELEASE', 'true');
    expect((await import('@/app/layout')).metadata.robots).toBeUndefined();
    vi.resetModules();
    vi.stubEnv('SITE_RELEASE', 'false');
    expect((await import('@/app/layout')).metadata.robots).toEqual({ index: false, follow: false });
  });
});
