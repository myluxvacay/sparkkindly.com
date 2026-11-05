// robots.txt (plan 6 review): the released site keeps crawlers out of /admin/ and the /go/<id>/ click route (a crawl
// there would count clicks or chase sponsor links); the preview site disallows everything.
import { describe, it, expect, vi } from 'vitest';

describe('robots', () => {
  it('released: allows the site, disallows /admin/ and /go/, lists the sitemap', async () => {
    vi.resetModules();
    vi.stubEnv('SITE_RELEASE', 'true');
    const robots = (await import('@/app/robots')).default;
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: ['/admin/', '/go/'] },
      sitemap: 'https://sparkkindly.com/sitemap.xml',
    });
  });

  it('preview: disallows everything', async () => {
    vi.resetModules();
    vi.stubEnv('SITE_RELEASE', 'false');
    const robots = (await import('@/app/robots')).default;
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    vi.unstubAllEnvs();
  });
});
