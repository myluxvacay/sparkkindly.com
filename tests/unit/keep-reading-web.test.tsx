// "Keep reading" panel (owner request, 20 Nov 2026): the next-article card and the three level
// choices render as plain links (no-JS path), the edge levels disable with a friendly note, Spark
// presents the choices with the waving artwork, and the collection link + deliberate reset are
// present. The island's tracking/gesture behaviour is pinned from source, in the house style of the
// keep-playing web test — including the child-safety carve-out: storage is only ever touched when
// the model's trackRead is on (never for Kids-audience articles).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import KeepReading from '@/components/item/KeepReading';
import { buildReadNextModel, type ReadCandidateInput } from '@/lib/read/read-next';

const enhancerSrc = readFileSync(`${process.cwd()}/components/item/ReadNextEnhancer.tsx`, 'utf8');
const pageSrc = readFileSync(`${process.cwd()}/app/[world]/[slug]/page.tsx`, 'utf8');
const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');

const input = (id: string, topics: string[], over: Partial<ReadCandidateInput> = {}): ReadCandidateInput => ({
  id,
  world: 'kids',
  slug: id,
  title: `Article ${id}`,
  summary: `Summary ${id}`,
  image: null,
  topics,
  publishedAt: '2026-11-20T00:00:00Z',
  ...over,
});
const CURRENT = { id: 'me', topics: ['reading', 'poster-series', 'phonics', 'grades-k-2'] };
const ITEMS = [
  input('me', CURRENT.topics),
  input('sibling', ['reading', 'poster-series', 'phonics', 'grades-k-2']),
  input('cousin', ['reading', 'poster-series', 'phonics', 'pre-k']),
  input('older', ['reading', 'poster-series', 'grammar', 'grades-3-5']),
];
const COLLECTION = { href: '/topics/reading/', label: 'Browse the whole reading collection' };

describe('KeepReading block', () => {
  it('renders the recommended article as a card with its title, reason and picture', () => {
    const model = buildReadNextModel(CURRENT, ITEMS, { collection: COLLECTION });
    const html = renderToStaticMarkup(<KeepReading model={model} />);
    expect(html).toContain('data-kr-btn="next"');
    expect(html).toContain('href="/kids/sibling/"');
    expect(html).toContain('Article sibling');
    expect(html).toContain('More Phonics in the Poster Series');
    // No stored hero: the card falls back to the article's template share image, like the page does.
    expect(html).toContain('/api/template-image/kids/sibling/');
    expect(html).toContain('Keep reading?');
    expect(html).toContain('/brand/spark-waving.gif');
    expect(html).toContain('data-kr-still="/brand/spark.webp"');
    // The model rides in the markup for the island's read-aware re-pick.
    expect(html).toContain('data-kr-model=');
  });

  it('renders the three level choices as plain links to each shelf’s first candidate', () => {
    const model = buildReadNextModel(CURRENT, ITEMS, { collection: COLLECTION });
    const html = renderToStaticMarkup(<KeepReading model={model} />);
    expect(html).toContain('Read an easier one');
    expect(html).toContain('Read another at this level');
    expect(html).toContain('Read a harder one');
    expect(html).toContain('data-kr-btn="easier"');
    expect(html).toContain('data-kr-btn="same"');
    expect(html).toContain('data-kr-btn="harder"');
    expect(html).toContain('href="/kids/cousin/"');
    expect(html).toContain('href="/kids/older/"');
    expect(html).toContain('data-kr-hint');
  });

  it('disables the edge levels with a friendly note instead of a dead link', () => {
    const youngest = buildReadNextModel({ id: 'me', topics: ['reading', 'poster-series', 'phonics', 'pre-k'] }, ITEMS, {
      collection: COLLECTION,
    });
    const html = renderToStaticMarkup(<KeepReading model={youngest} />);
    expect(html).toContain('This is the gentlest level');
    expect(html).toContain('kr-btn-off');
  });

  it('links back to the collection and offers the deliberate reset only when tracking', () => {
    const tracked = renderToStaticMarkup(<KeepReading model={buildReadNextModel(CURRENT, ITEMS, { collection: COLLECTION })} />);
    expect(tracked).toContain('href="/topics/reading/"');
    expect(tracked).toContain('Browse the whole reading collection');
    expect(tracked).toContain('data-kr-fresh');
    const untracked = renderToStaticMarkup(
      <KeepReading model={buildReadNextModel(CURRENT, ITEMS, { collection: COLLECTION, trackRead: false })} />,
    );
    expect(untracked).not.toContain('data-kr-fresh');
    // The choices themselves are unaffected by the carve-out — only the storage is.
    expect(untracked).toContain('data-kr-btn="next"');
  });

  it('renders nothing when there is no next article', () => {
    const model = buildReadNextModel(CURRENT, [input('me', CURRENT.topics)], { collection: COLLECTION });
    expect(renderToStaticMarkup(<KeepReading model={model} />)).toBe('');
  });
});

describe('reading island + page wiring (source pins)', () => {
  it('the island gates every storage touch on trackRead', () => {
    // The read set is empty and markRead is never called when tracking is off — the carve-out.
    expect(enhancerSrc).toContain('theModel.trackRead ? readIds(loadRead(krStorage())) : new Set<string>()');
    expect(enhancerSrc).toContain('if (theModel.trackRead) {');
    expect(enhancerSrc).toContain('markRead(loadRead(backend), theModel.currentId, Date.now())');
  });

  it('the island plays Spark’s voice only from the Spark tap, and reuses the flick detector', () => {
    expect(enhancerSrc).toContain("playSparkVoice('greeting')");
    expect(enhancerSrc).toContain("target.closest('[data-kr-voice]')");
    expect(enhancerSrc).toContain('detectFlick');
  });

  it('the page turns tracking off for Kids-audience articles, like the play panel does', () => {
    expect(pageSrc).toContain("trackRead: item.audience !== 'kids'");
    expect(pageSrc).toContain('buildReadNextModel');
  });

  it('the panel has its own light-surface styles with the gold button pairing', () => {
    expect(css).toContain('.keep-reading{');
    expect(css).toContain('.kr-btn{');
    expect(css).toContain('.kr-flick{touch-action:none}');
  });
});
