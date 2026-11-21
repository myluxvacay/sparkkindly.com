// "Keep reading" selection (owner request, 20 Nov 2026): the pure logic — similarity scoring from the
// metadata articles actually carry, band-ladder resolution with edge and empty-band behaviour, and
// the model the panel renders (primary pick, level shelves, deterministic rotation).
import { describe, it, expect } from 'vitest';
import {
  BAND_ORDER,
  bandOf,
  buildReadNextModel,
  reasonFor,
  resolveBandDirection,
  rotateReadCandidates,
  scoreCandidate,
  trackOf,
  type Band,
  type ReadCandidate,
  type ReadCandidateInput,
} from '@/lib/read/read-next';

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
const cand = (id: string, topics: string[] = []): ReadCandidate => ({
  id,
  href: `/kids/${id}/`,
  title: id,
  summary: '',
  image: null,
  topics,
  band: bandOf(topics),
  score: 0,
});
const pools = (p: Partial<Record<Band, ReadCandidate[]>>): Record<Band, ReadCandidate[]> => ({
  'pre-k': [],
  'grades-k-2': [],
  'grades-3-5': [],
  ...p,
});
const COLLECTION = { href: '/topics/reading/', label: 'Browse the whole reading collection' };

describe('bandOf / trackOf', () => {
  it('reads the band and track out of an article’s topics', () => {
    const topics = ['reading', 'poster-series', 'phonics', 'grades-k-2'];
    expect(bandOf(topics)).toBe('grades-k-2');
    expect(trackOf(topics)).toBe('phonics');
    expect(bandOf(['science', 'animals'])).toBeNull();
    expect(trackOf(['science', 'animals'])).toBeNull();
    expect(bandOf([])).toBeNull();
  });
});

describe('scoreCandidate', () => {
  const current = ['reading', 'poster-series', 'phonics', 'grades-k-2'];
  it('ranks the same series + track above everything else', () => {
    const sameSeriesTrack = scoreCandidate(current, ['reading', 'poster-series', 'phonics', 'grades-3-5']);
    const sameTrackOnly = scoreCandidate(current, ['phonics', 'words']);
    const sameBandOnly = scoreCandidate(current, ['grades-k-2', 'animals']);
    const ordinaryTopic = scoreCandidate(['science', 'animals'], ['animals', 'plants']);
    const nothingShared = scoreCandidate(current, ['science', 'space']);
    expect(sameSeriesTrack).toBeGreaterThan(sameTrackOnly);
    expect(sameTrackOnly).toBeGreaterThan(sameBandOnly);
    expect(sameBandOnly).toBeGreaterThan(ordinaryTopic);
    expect(ordinaryTopic).toBeGreaterThan(0);
    expect(nothingShared).toBe(0);
  });

  it('counts shared ordinary topics for library articles with no structural tags', () => {
    expect(scoreCandidate(['science', 'animals', 'weather'], ['animals', 'weather'])).toBe(20);
    expect(scoreCandidate(['science', 'animals'], ['nature', 'animals', 'plants'])).toBe(10);
  });
});

describe('reasonFor', () => {
  const current = ['reading', 'poster-series', 'phonics', 'grades-k-2'];
  it('names the track and series when both match', () => {
    expect(reasonFor(current, { topics: ['reading', 'poster-series', 'phonics', 'pre-k'] })).toBe(
      'More Phonics in the Poster Series',
    );
  });
  it('falls back through track, series, ordinary topic, band and collection', () => {
    expect(reasonFor(current, { topics: ['phonics'] })).toBe('More Phonics to read');
    expect(reasonFor(current, { topics: ['poster-series', 'grammar', 'pre-k'] })).toBe('More from the Poster Series');
    expect(reasonFor(['science', 'earth-science'], { topics: ['earth-science'] })).toBe('More about Earth science');
    expect(reasonFor(current, { topics: ['grades-k-2', 'animals'] })).toBe('Grades K–2 reading');
    expect(reasonFor(current, { topics: ['reading', 'animals'] })).toBe('More reading to explore');
    expect(reasonFor(current, { topics: ['animals'] })).toBe('Another article to read');
  });
});

describe('resolveBandDirection', () => {
  it('steps one band up or down when that band is populated', () => {
    const p = pools({ 'pre-k': [cand('a')], 'grades-k-2': [cand('b')], 'grades-3-5': [cand('c')] });
    expect(resolveBandDirection('grades-k-2', 'harder', p)).toEqual({ band: 'grades-3-5', skipped: false });
    expect(resolveBandDirection('grades-k-2', 'easier', p)).toEqual({ band: 'pre-k', skipped: false });
    expect(resolveBandDirection('grades-k-2', 'same', p)).toEqual({ band: 'grades-k-2', skipped: false });
  });

  it('is a dead end at the edges of the ladder, never a wrap-around', () => {
    const p = pools({ 'pre-k': [cand('a')], 'grades-k-2': [cand('b')], 'grades-3-5': [cand('c')] });
    expect(resolveBandDirection('pre-k', 'easier', p)).toBeNull();
    expect(resolveBandDirection('grades-3-5', 'harder', p)).toBeNull();
  });

  it('skips an empty band and says so', () => {
    const p = pools({ 'pre-k': [cand('a')], 'grades-3-5': [cand('c')] });
    expect(resolveBandDirection('pre-k', 'harder', p)).toEqual({ band: 'grades-3-5', skipped: true });
  });

  it('same level falls to the nearest populated band, gentler side first', () => {
    const both = pools({ 'pre-k': [cand('a')], 'grades-3-5': [cand('c')] });
    expect(resolveBandDirection('grades-k-2', 'same', both)).toEqual({ band: 'pre-k', skipped: true });
    const upOnly = pools({ 'grades-3-5': [cand('c')] });
    expect(resolveBandDirection('grades-k-2', 'same', upOnly)).toEqual({ band: 'grades-3-5', skipped: true });
    expect(resolveBandDirection('grades-k-2', 'same', pools({}))).toBeNull();
  });
});

describe('rotateReadCandidates', () => {
  it('is deterministic for a seed and rotates the starting point', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => cand(id));
    const once = rotateReadCandidates(list, 'seed-1');
    const twice = rotateReadCandidates(list, 'seed-1');
    expect(once.map((x) => x.id)).toEqual(twice.map((x) => x.id));
    expect(once.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateReadCandidates([cand('only')], 'seed-1').map((x) => x.id)).toEqual(['only']);
  });
});

describe('buildReadNextModel', () => {
  const current = { id: 'me', topics: ['reading', 'poster-series', 'phonics', 'grades-k-2'] };
  const items = [
    input('me', current.topics),
    input('sibling', ['reading', 'poster-series', 'phonics', 'grades-k-2'], { publishedAt: '2026-11-19T00:00:00Z' }),
    input('cousin', ['reading', 'poster-series', 'phonics', 'pre-k']),
    input('older', ['reading', 'poster-series', 'grammar', 'grades-3-5']),
    input('other-world', ['science', 'animals'], { world: 'discover' }),
  ];

  it('excludes the current article and picks the closest sibling as primary', () => {
    const model = buildReadNextModel(current, items, { collection: COLLECTION });
    expect(model.primary?.id).toBe('sibling');
    expect(model.primaryReason).toBe('More Phonics in the Poster Series');
    expect(model.next.map((c) => c.id)).not.toContain('me');
    expect(model.currentBand).toBe('grades-k-2');
    expect(model.collection).toEqual(COLLECTION);
  });

  it('builds the three level shelves from the band pools', () => {
    const model = buildReadNextModel(current, items, { collection: COLLECTION });
    expect(model.options?.same?.band).toBe('grades-k-2');
    expect(model.options?.same?.candidates.map((c) => c.id)).toEqual(['sibling']);
    expect(model.options?.easier?.band).toBe('pre-k');
    expect(model.options?.easier?.candidates.map((c) => c.id)).toEqual(['cousin']);
    expect(model.options?.harder?.band).toBe('grades-3-5');
    expect(model.options?.harder?.candidates.map((c) => c.id)).toEqual(['older']);
  });

  it('has no level shelves for an unbanded article, but still recommends by topics', () => {
    const model = buildReadNextModel(
      { id: 'x', topics: ['science', 'animals'] },
      [input('x', ['science', 'animals']), input('y', ['animals', 'plants'], { world: 'discover' }), input('z', ['money-basics'], { world: 'save' })],
      { collection: { href: '/discover/', label: 'More in Discover' } },
    );
    expect(model.options).toBeNull();
    expect(model.currentBand).toBeNull();
    expect(model.primary?.id).toBe('y');
    expect(model.primaryReason).toBe('More about Animals');
  });

  it('falls back to the best article overall when the reader’s own band is empty', () => {
    const model = buildReadNextModel(
      { id: 'me', topics: ['reading', 'poster-series', 'grammar', 'grades-3-5'] },
      [input('me', ['reading', 'poster-series', 'grammar', 'grades-3-5']), input('young', ['reading', 'poster-series', 'grammar', 'pre-k'])],
      { collection: COLLECTION },
    );
    expect(model.primary?.id).toBe('young');
    // "Same" resolves down the ladder and says it skipped.
    expect(model.options?.same?.band).toBe('pre-k');
    expect(model.options?.same?.skipped).toBe(true);
    expect(model.options?.harder).toBeNull();
  });

  it('returns no primary when the library holds nothing else', () => {
    const model = buildReadNextModel(current, [input('me', current.topics)], { collection: COLLECTION });
    expect(model.primary).toBeNull();
    expect(model.next).toEqual([]);
  });

  it('carries the trackRead flag through, defaulting to on', () => {
    expect(buildReadNextModel(current, items, { collection: COLLECTION }).trackRead).toBe(true);
    expect(buildReadNextModel(current, items, { collection: COLLECTION, trackRead: false }).trackRead).toBe(false);
  });

  it('orders equal scores newest first', () => {
    const model = buildReadNextModel(
      { id: 'me', topics: ['science'] },
      [
        input('me', ['science']),
        input('old', ['animals'], { publishedAt: '2026-01-01T00:00:00Z' }),
        input('new', ['plants'], { publishedAt: '2026-11-01T00:00:00Z' }),
      ],
      { collection: COLLECTION },
    );
    expect(model.next.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('keeps every band in BAND_ORDER reachable in the pools', () => {
    for (const band of BAND_ORDER) {
      const model = buildReadNextModel({ id: 'me', topics: ['reading', band] }, [input('me', ['reading', band]), input('other', ['reading', band])], {
        collection: COLLECTION,
      });
      expect(model.options?.same?.band).toBe(band);
    }
  });
});
