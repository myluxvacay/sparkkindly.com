// SEO audit L6: the per-item report link is rel="nofollow" (a form per item is not worth crawling).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportLink from '@/components/item/ReportLink';

describe('ReportLink', () => {
  it('links to the report form with rel="nofollow"', () => {
    const html = renderToStaticMarkup(<ReportLink world="play" slug="a-slug" />);
    expect(html).toMatch(/href="\/report\/play\/a-slug\/?"/); // the app config adds the trailing slash
    expect(html).toContain('rel="nofollow"');
  });
});
