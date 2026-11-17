// "Keep playing" difficulty flow (owner request, 17 Nov 2026): the pure selection logic — level
// resolution with edge and empty-level behaviour, session-exclusion picking, and flick detection.
import { describe, it, expect } from 'vitest';
import {
  buildModel,
  detectFlick,
  pickCandidate,
  poolQuizzes,
  resolveDirection,
  rotateCandidates,
  type CandidatePools,
} from '@/lib/play/keep-playing';

const c = (id: string) => ({ id, href: `/discover/${id}/` });
const pools = (p: Partial<CandidatePools>): CandidatePools => ({ easy: [], medium: [], hard: [], ...p });

describe('poolQuizzes', () => {
  it('groups by difficulty, excludes the quiz just played, skips quizzes with no readable level', () => {
    const grouped = poolQuizzes(
      [
        { id: 'a', world: 'discover', slug: 'a', difficulty: 'easy' },
        { id: 'b', world: 'play', slug: 'b', difficulty: 'easy' },
        { id: 'me', world: 'play', slug: 'me', difficulty: 'medium' },
        { id: 'd', world: 'grow', slug: 'd', difficulty: 'hard' },
        { id: 'e', world: 'grow', slug: 'e' },
      ],
      'me',
    );
    expect(grouped.easy.map((x) => x.id)).toEqual(['a', 'b']);
    expect(grouped.medium).toEqual([]);
    expect(grouped.hard).toEqual([{ id: 'd', href: '/grow/d/' }]);
  });
});

describe('resolveDirection', () => {
  it('steps one level up or down when that level is populated', () => {
    const p = pools({ easy: [c('e')], medium: [c('m')], hard: [c('h')] });
    expect(resolveDirection('medium', 'harder', p)).toEqual({ level: 'hard', skipped: false });
    expect(resolveDirection('medium', 'easier', p)).toEqual({ level: 'easy', skipped: false });
    expect(resolveDirection('medium', 'same', p)).toEqual({ level: 'medium', skipped: false });
  });

  it('is a dead end at the edges of the scale, never a wrap-around', () => {
    const p = pools({ easy: [c('e')], medium: [c('m')], hard: [c('h')] });
    expect(resolveDirection('easy', 'easier', p)).toBeNull();
    expect(resolveDirection('hard', 'harder', p)).toBeNull();
  });

  it('skips an empty level in the same direction and says so', () => {
    const p = pools({ easy: [c('e')], hard: [c('h')] });
    expect(resolveDirection('hard', 'easier', p)).toEqual({ level: 'easy', skipped: true });
    expect(resolveDirection('easy', 'harder', p)).toEqual({ level: 'hard', skipped: true });
  });

  it('returns null when nothing is populated in that direction', () => {
    const p = pools({ easy: [c('e')] });
    expect(resolveDirection('easy', 'harder', p)).toBeNull();
    expect(resolveDirection('medium', 'harder', p)).toBeNull();
  });

  it('same level falls back to the nearest populated level (gentler first) when its own level is empty', () => {
    const p = pools({ easy: [c('e')], hard: [c('h')] });
    expect(resolveDirection('medium', 'same', p)).toEqual({ level: 'easy', skipped: true });
    expect(resolveDirection('medium', 'same', pools({}))).toBeNull();
  });
});

describe('rotateCandidates', () => {
  it('is deterministic, keeps every candidate, and varies the lead by seed', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    const r1 = rotateCandidates(list, 'quiz-one');
    expect(rotateCandidates(list, 'quiz-one')).toEqual(r1);
    expect([...r1].sort((x, y) => x.id.localeCompare(y.id))).toEqual(list);
    const leads = new Set(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((s) => rotateCandidates(list, s)[0].id));
    expect(leads.size).toBeGreaterThan(1);
    expect(rotateCandidates([c('a')], 'x')).toEqual([c('a')]);
    expect(rotateCandidates([], 'x')).toEqual([]);
  });
});

describe('pickCandidate', () => {
  it('serves the first candidate the session has not played', () => {
    const list = [c('a'), c('b'), c('c')];
    expect(pickCandidate(list, new Set())).toEqual({ candidate: list[0], exhausted: false });
    expect(pickCandidate(list, new Set(['a', 'b']))).toEqual({ candidate: list[2], exhausted: false });
  });

  it('reports exhaustion instead of dead-ending when the whole level was played', () => {
    const list = [c('a'), c('b')];
    expect(pickCandidate(list, new Set(['a', 'b']))).toEqual({ candidate: list[0], exhausted: true });
    expect(pickCandidate([], new Set())).toBeNull();
  });
});

describe('detectFlick', () => {
  it('reads a fast, mostly-vertical flick up as harder and down as easier', () => {
    expect(detectFlick({ dx: 6, dy: -90, durationMs: 180 })).toBe('up');
    expect(detectFlick({ dx: -10, dy: 120, durationMs: 240 })).toBe('down');
  });

  it('never hijacks a scroll: slow drags, short drifts and sideways swipes are not flicks', () => {
    expect(detectFlick({ dx: 0, dy: -140, durationMs: 900 })).toBeNull(); // a scroll in progress
    expect(detectFlick({ dx: 0, dy: 30, durationMs: 120 })).toBeNull(); // too short
    expect(detectFlick({ dx: 140, dy: 70, durationMs: 200 })).toBeNull(); // sideways-dominant
    expect(detectFlick({ dx: 0, dy: 0, durationMs: 90 })).toBeNull(); // a tap
  });
});

describe('buildModel', () => {
  it('composes the three options from the pools around the current level', () => {
    const p = pools({ easy: [c('e')], medium: [c('m')], hard: [c('h')] });
    const model = buildModel('me', 'medium', p);
    expect(model.currentId).toBe('me');
    expect(model.options.easier?.level).toBe('easy');
    expect(model.options.same?.candidates).toEqual([c('m')]);
    expect(model.options.harder?.level).toBe('hard');
    expect(buildModel('me', 'easy', p).options.easier).toBeNull();
  });

  it('carries each level’s true total alongside its (capped) candidates, plus the account seen ids', () => {
    const many = Array.from({ length: 60 }, (_, i) => c(`m${i}`));
    const model = buildModel('me', 'easy', pools({ medium: many }), { accountSeen: ['m3', 'm7'], signedIn: true });
    expect(model.options.harder?.total).toBe(60);
    expect(model.options.harder?.candidates).toHaveLength(50);
    expect(model.accountSeen).toEqual(['m3', 'm7']);
    expect(model.signedIn).toBe(true);
    const anon = buildModel('me', 'easy', pools({}));
    expect(anon.accountSeen).toEqual([]);
    expect(anon.signedIn).toBe(false);
  });
});
