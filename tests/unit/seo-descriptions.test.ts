// SEO audit M6: every trust page and the topic template has a meta description of 70 to 160 characters (written to
// 110-160), and the topic description names the topic and its item count.
import { describe, it, expect, vi } from 'vitest';
import type { Metadata } from 'next';
import { topicDescription } from '@/lib/public/topics';

const PAGES = [
  'app/(trust)/editorial-policy/page',
  'app/(trust)/accessibility/page',
  'app/(trust)/privacy/page',
  'app/(trust)/terms/page',
  'app/(trust)/about/page',
  'app/(trust)/contact/page',
  'app/community/guidelines/page',
  'app/contributors/terms/page',
  'app/sponsorship/page',
];

async function descriptionOf(file: string): Promise<string> {
  const mod = (await import(`@/${file}`)) as { metadata?: Metadata; generateMetadata?: () => Promise<Metadata> };
  const m = mod.metadata ?? (await mod.generateMetadata!());
  return String(m.description ?? '');
}

describe('trust page descriptions', () => {
  it.each(PAGES)('%s: 70 to 160 characters', async (file) => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('COMMENTS_ENABLED', 'true');
    const d = await descriptionOf(file);
    expect(d.length, d).toBeGreaterThanOrEqual(70);
    expect(d.length, d).toBeLessThanOrEqual(160);
  });
});

describe('topicDescription', () => {
  it.each([
    ['Owls', 1],
    ['Kindness at work', 12],
    ['A', 0],
    ['A topic name that is about as long as a curated topic name ever gets', 9999],
  ])('%s with %i items: names both, 70 to 160 characters', (name, count) => {
    const d = topicDescription(name, count);
    expect(d).toContain(name);
    expect(d).toContain(String(count));
    expect(d.length, d).toBeGreaterThanOrEqual(70);
    expect(d.length, d).toBeLessThanOrEqual(160);
  });

  it('says "1 item", not "1 items"', () => {
    expect(topicDescription('Owls', 1)).toMatch(/\b1 item\b/);
  });
});
