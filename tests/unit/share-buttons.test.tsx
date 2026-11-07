// Share buttons on item pages (owner request): exact, encoded hrefs from the clean canonical URL and the title only;
// Kids items and child contexts get only the allowed set; the client island is the only new client component.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ShareButtons from '@/components/item/ShareButtons';
import { isChildScope, shareLinks, shareUrl } from '@/lib/public/share';

const BASE = 'https://sparkkindly.com';
const article = { world: 'discover', slug: 'a-day-in-shadows', title: 'A day in "shadows" & light?', kind: 'article', audience: 'all' };
const quiz = { world: 'play', slug: 'number-detective-001', title: 'Number detective', kind: 'quiz', audience: 'all' };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

describe('shareLinks', () => {
  it('builds every href exactly, encoding every value', () => {
    const url = 'https://sparkkindly.com/discover/a-day-in-shadows/';
    const text = 'A day in "shadows" & light?';
    const e = encodeURIComponent;
    expect(shareLinks(BASE, article, false)).toEqual([
      { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${e(`${text} ${url}`)}` },
      { id: 'sms', label: 'Text message', href: `sms:?&body=${e(`${text} ${url}`)}` },
      { id: 'email', label: 'Email', href: `mailto:?subject=${e(text)}&body=${e(`${text} ${url}`)}` },
      { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
      { id: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}` },
      { id: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${e(url)}&text=${e(text)}` },
    ]);
    expect(shareLinks(BASE, article, false)[0].href).toContain('%22shadows%22%20%26%20light%3F');
  });

  it('the shared URL is the clean canonical: absolute https, trailing slash, no query', () => {
    const url = shareUrl(BASE, article);
    expect(url).toBe('https://sparkkindly.com/discover/a-day-in-shadows/');
    expect(url).not.toContain('?');
  });

  it('quizzes and games lead in neutrally; the text is never more than the title', () => {
    const wa = decodeURIComponent(shareLinks(BASE, quiz, false)[0].href.split('text=')[1]);
    expect(wa).toBe('Can you get this one? Number detective https://sparkkindly.com/play/number-detective-001/');
  });

  it('a Kids item (world or audience) gets no social-network links; email and text stay for an adult', () => {
    for (const k of [{ ...quiz, world: 'kids' }, { ...quiz, audience: 'kids' }]) {
      expect(shareLinks(BASE, k, false).map((l) => l.id)).toEqual(['sms', 'email']);
    }
  });

  it('a child context gets no link at all (only the device share and copy buttons)', () => {
    expect(shareLinks(BASE, article, true)).toEqual([]);
    expect(shareLinks(BASE, { ...quiz, world: 'kids' }, true)).toEqual([]);
  });
});

describe('isChildScope', () => {
  it('is true for a scope without adults (child profile or failed lookup), false for anonymous and adults', () => {
    expect(isChildScope({ audiences: ['kids', 'all'] })).toBe(true);
    expect(isChildScope({ audiences: [] })).toBe(true);
    expect(isChildScope({ audiences: ['kids', 'all', 'adults'] })).toBe(false);
  });
});

describe('ShareButtons', () => {
  it('renders a "Share this" h2 and labelled links; http(s) links open a new tab with noopener noreferrer', () => {
    const html = renderToStaticMarkup(<ShareButtons item={article} childContext={false} />);
    expect(html).toMatch(/<h2[^>]*>Share this<\/h2>/);
    for (const label of ['WhatsApp', 'Text message', 'Email', 'Facebook', 'X', 'Telegram']) expect(html).toContain(`>${label}</a>`);
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(6);
    for (const a of anchors) {
      expect(a).toContain('rel="noopener noreferrer"');
      if (/href="https:/.test(a)) expect(a).toContain('target="_blank"');
      else expect(a).not.toContain('target=');
    }
  });

  it('carries no answer, explanation or query state in any href', () => {
    const html = renderToStaticMarkup(<ShareButtons item={{ ...quiz, title: 'Number detective' }} childContext={false} />);
    for (const h of hrefs(html)) {
      const decoded = decodeURIComponent(h);
      expect(decoded).not.toMatch(/correct|explanation|answer=|result|score|utm_|\?a=|&a=/i);
      expect(decoded).not.toMatch(/number-detective-001\/\?/);
    }
  });

  it('a child context renders the section with no links (the island adds device share and copy)', () => {
    const html = renderToStaticMarkup(<ShareButtons item={article} childContext={true} />);
    expect(html).toContain('Share this');
    expect(hrefs(html)).toEqual([]);
  });
});

describe('client components', () => {
  it('ShareClient is the only new client component', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => path.join(dir, f).split(path.sep).join('/'));
    const client = [...files('app'), ...files('components'), ...files('lib')]
      .filter((f) => /^['"]use client['"]/m.test(readFileSync(f, 'utf8')))
      .sort();
    expect(client).toEqual([
      'app/error.tsx',
      'components/Header.tsx',
      'components/SocialLinks.tsx',
      'components/admin/VideoUpload.tsx',
      'components/item/ShareClient.tsx',
    ]);
  });

  it('ShareClient uses no storage and no network', () => {
    const src = readFileSync('components/item/ShareClient.tsx', 'utf8');
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/);
  });
});
