// Social distribution rules (plan 5A Task 1), pure: eligibility (never Kids by world, audience or risk tier; only
// published items of a kind the site renders), the distribution state machine, the candidate ordering (world rotation,
// playable first, topic popularity, newest) and the server-built UTM link.
import { describe, it, expect } from 'vitest';
import { isEligibleForSocial } from '@/lib/social/eligibility';
import { EVENTS, nextStatus, STATUSES, type DistEvent } from '@/lib/social/states';
import { orderCandidates, skipReason, type Candidate } from '@/lib/social/select';
import { buildLink } from '@/lib/social/links';

const ok = { worldSlug: 'play', audience: 'all', riskTier: 'reflective', status: 'published', kind: 'quiz' };

describe('isEligibleForSocial', () => {
  it('accepts a published quiz, game or article outside Kids', () => {
    for (const kind of ['quiz', 'game', 'article']) expect(isEligibleForSocial({ ...ok, kind })).toBe(true);
    expect(isEligibleForSocial({ ...ok, audience: 'adults' })).toBe(true);
  });

  it.each([
    ['Kids world', { worldSlug: 'kids' }],
    ['kids audience', { audience: 'kids' }],
    ['kids risk tier', { riskTier: 'kids' }],
    ['draft', { status: 'draft' }],
    ['scheduled', { status: 'scheduled' }],
    ['archived', { status: 'archived' }],
    ['in review', { status: 'in_review' }],
    ['video script (Part B)', { kind: 'video_script' }],
    ['puzzle (not rendered)', { kind: 'puzzle' }],
  ])('refuses %s', (_, patch) => {
    expect(isEligibleForSocial({ ...ok, ...patch })).toBe(false);
  });

  it('fails closed on a missing or malformed item', () => {
    expect(isEligibleForSocial(null as never)).toBe(false);
    expect(isEligibleForSocial({} as never)).toBe(false);
  });
});

describe('nextStatus', () => {
  const legal: [string, DistEvent, string][] = [
    ['selected', 'copy', 'copy_ready'],
    ['copy_ready', 'schedule', 'scheduled'],
    ['scheduled', 'claim', 'posting'],
    ['posting', 'posted', 'posted'],
    ['posting', 'defer', 'scheduled'],
    ['posting', 'fail', 'failed'],
    ['posting', 'flag', 'flagged'],
    ['posted', 'flag', 'flagged'],
    ['selected', 'cancel', 'cancelled'],
    ['copy_ready', 'cancel', 'cancelled'],
    ['scheduled', 'cancel', 'cancelled'],
    ['posting', 'cancel', 'cancelled'],
    ['failed', 'cancel', 'cancelled'],
    ['failed', 'retry', 'scheduled'],
    ['skipped', 'pick', 'selected'],
    ['cancelled', 'pick', 'selected'],
  ];

  it.each(legal)('%s --%s--> %s', (from, event, to) => {
    expect(nextStatus(from as never, event)).toBe(to);
  });

  it('every other (status, event) pair is illegal', () => {
    const allowed = new Set(legal.map(([f, e]) => `${f}:${e}`));
    for (const s of STATUSES) {
      for (const e of Object.keys(EVENTS) as DistEvent[]) {
        if (!allowed.has(`${s}:${e}`)) expect(nextStatus(s, e), `${s}:${e}`).toBeNull();
      }
    }
  });

  it('posted is never retried, re-scheduled or cancelled; flagged and cancelled lead nowhere automatic', () => {
    for (const e of ['retry', 'defer', 'claim', 'cancel', 'schedule'] as DistEvent[]) expect(nextStatus('posted', e)).toBeNull();
    for (const e of Object.keys(EVENTS) as DistEvent[]) expect(nextStatus('flagged', e)).toBeNull();
    expect(nextStatus('posting', 'retry')).toBeNull();
  });

  it('an unknown event or status is illegal', () => {
    expect(nextStatus('selected', 'nope' as never)).toBeNull();
    expect(nextStatus('nope' as never, 'copy')).toBeNull();
  });
});

const c = (itemId: string, worldSlug: string, kind: string, topicScore: number, publishedAt: string): Candidate => ({
  itemId,
  worldSlug,
  kind,
  topicScore,
  publishedAt: new Date(publishedAt),
});

describe('orderCandidates', () => {
  const cands = [
    c('grow-article-new', 'grow', 'article', 0, '2026-11-05T06:00:00Z'),
    c('grow-quiz', 'grow', 'quiz', 0, '2026-11-03T06:00:00Z'),
    c('play-game-pop', 'play', 'game', 9, '2026-11-03T06:00:00Z'),
    c('play-game', 'play', 'game', 2, '2026-11-04T06:00:00Z'),
    c('play-quiz-new', 'play', 'quiz', 2, '2026-11-05T06:00:00Z'),
    c('discover-article', 'discover', 'article', 5, '2026-11-04T06:00:00Z'),
  ];
  // grow never posted, then discover (oldest post), then play.
  const last = { play: new Date('2026-11-04T12:00:00Z'), discover: new Date('2026-11-01T12:00:00Z') };

  it('rotates worlds by oldest last post (never posted first), one item per world per round', () => {
    expect(orderCandidates(cands, last).map((x) => x.itemId)).toEqual([
      'grow-quiz',
      'discover-article',
      'play-game-pop',
      'grow-article-new',
      'play-quiz-new',
      'play-game',
    ]);
  });

  it('within a world: playable before article, then topic popularity, then newest', () => {
    const order = orderCandidates(cands, last).filter((x) => x.worldSlug === 'play').map((x) => x.itemId);
    expect(order).toEqual(['play-game-pop', 'play-quiz-new', 'play-game']);
  });

  it('is pure and deterministic (same input, same output; input untouched)', () => {
    const copy = [...cands];
    expect(orderCandidates(cands, last)).toEqual(orderCandidates([...cands].reverse(), last));
    expect(cands).toEqual(copy);
  });

  it('breaks a tie between never-posted worlds by slug', () => {
    const r = orderCandidates([c('b', 'together', 'quiz', 0, '2026-11-04T00:00:00Z'), c('a', 'discover', 'quiz', 0, '2026-11-04T00:00:00Z')], {});
    expect(r.map((x) => x.itemId)).toEqual(['a', 'b']);
  });
});

describe('skipReason', () => {
  const ordered = orderCandidates(
    [
      c('play-game', 'play', 'game', 1, '2026-11-04T00:00:00Z'),
      c('play-article', 'play', 'article', 9, '2026-11-04T00:00:00Z'),
      c('play-game-low', 'play', 'game', 0, '2026-11-04T00:00:00Z'),
      c('play-game-old', 'play', 'game', 1, '2026-11-03T00:00:00Z'),
      c('grow-quiz', 'grow', 'quiz', 0, '2026-11-04T00:00:00Z'),
    ],
    { grow: new Date('2026-11-04T00:00:00Z') },
  );

  it('names a fixed reason for every candidate not picked', () => {
    const byId = Object.fromEntries(ordered.map((x) => [x.itemId, x]));
    expect(skipReason(byId['grow-quiz'], ordered, 1)).toBe('world_rotation');
    expect(skipReason(byId['play-article'], ordered, 1)).toBe('not_playable');
    expect(skipReason(byId['play-game-low'], ordered, 1)).toBe('lower_topic_popularity');
    expect(skipReason(byId['play-game-old'], ordered, 1)).toBe('cap_reached');
  });

  it('with a cap of 0 every candidate is cap_reached', () => {
    for (const x of ordered) expect(skipReason(x, ordered, 0)).toBe('cap_reached');
  });
});

describe('buildLink', () => {
  it('builds the item URL with only the allowed UTM values', () => {
    expect(buildLink('https://sparkkindly.com', { world: 'play', slug: 'odd-one-out' }, 'instagram')).toBe(
      'https://sparkkindly.com/play/odd-one-out/?utm_source=instagram&utm_medium=social&utm_campaign=play-odd-one-out',
    );
    expect(buildLink('https://staging.sparkkindly.com/', { world: 'grow', slug: 'a-b' }, 'facebook')).toBe(
      'https://staging.sparkkindly.com/grow/a-b/?utm_source=facebook&utm_medium=social&utm_campaign=grow-a-b',
    );
  });

  it('refuses an unknown platform, a malformed slug or world, and a site that is not https', () => {
    expect(() => buildLink('https://sparkkindly.com', { world: 'play', slug: 'x' }, 'twitter' as never)).toThrow();
    expect(() => buildLink('https://sparkkindly.com', { world: 'play', slug: 'x?y=1' }, 'instagram')).toThrow();
    expect(() => buildLink('https://sparkkindly.com', { world: '../admin', slug: 'x' }, 'instagram')).toThrow();
    expect(() => buildLink('http://sparkkindly.com', { world: 'play', slug: 'x' }, 'instagram')).toThrow();
    expect(() => buildLink('https://evil.example/@x', { world: 'play', slug: 'x' }, 'instagram')).toThrow();
  });
});
