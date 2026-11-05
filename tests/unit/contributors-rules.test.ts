// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  CONTRIBUTOR_LIMITS,
  cleanBio,
  cleanContributorName,
  cleanLink,
  createContributorLimits,
  newItemSlug,
  newProfileSlug,
  parseDraft,
  toSubmission,
} from '@/lib/contributors/rules';
import { nextState, STATES, EVENTS, type State, type Event } from '@/lib/contributors/states';
import { itemSubmissionSchema } from '@/lib/items/format';

const NOW = new Date('2026-11-05T10:00:00Z');

const article = {
  kind: 'article',
  world: 'discover',
  title: 'Why the sky looks blue',
  summary: 'A short look at how sunlight scatters in the air above us.',
  topics: [],
  sources: [{ title: 'NASA', url: 'https://science.nasa.gov/sky' }],
  sections: [
    { heading: 'Sunlight', text: 'Sunlight holds every colour.\n\nBlue light scatters more.' },
    { heading: 'Air', text: 'Small molecules scatter short waves.' },
  ],
  takeaway: 'Look up and think of tiny molecules.',
};
const quiz = {
  kind: 'quiz',
  world: 'play',
  title: 'Which planet is largest?',
  summary: 'A quick question about the planets in our solar system.',
  question: 'Which planet in our solar system is the largest?',
  options: ['Mars', 'Jupiter', 'Venus', 'Earth'],
  correct: 1,
  explanation: 'Jupiter is more than eleven times as wide as Earth.',
};

describe('nextState', () => {
  const legal: [State, Event, State][] = [
    ['draft', 'save', 'draft'],
    ['draft', 'submit', 'submitted'],
    ['draft', 'withdraw', 'withdrawn'],
    ['submitted', 'gates_pass', 'agent_review'],
    ['submitted', 'gates_fail', 'draft'],
    ['submitted', 'withdraw', 'withdrawn'],
    ['agent_review', 'review_pass', 'needs_owner'],
    ['agent_review', 'review_fail', 'changes_requested'],
    ['agent_review', 'withdraw', 'withdrawn'],
    ['needs_owner', 'approve', 'approved'],
    ['needs_owner', 'request_changes', 'changes_requested'],
    ['needs_owner', 'reject', 'rejected'],
    ['needs_owner', 'withdraw', 'withdrawn'],
    ['changes_requested', 'save', 'changes_requested'],
    ['changes_requested', 'submit', 'submitted'],
    ['changes_requested', 'withdraw', 'withdrawn'],
    ['approved', 'withdraw', 'withdrawn'],
    ['rejected', 'withdraw', 'withdrawn'],
  ];

  it('allows every legal transition', () => {
    for (const [from, event, to] of legal) expect(nextState(from, event), `${from} ${event}`).toBe(to);
  });

  it('refuses every other pair (null), so nothing skips the reviewer or the owner', () => {
    const ok = new Set(legal.map(([f, e]) => `${f}|${e}`));
    let refused = 0;
    for (const s of STATES) {
      for (const e of EVENTS) {
        if (ok.has(`${s}|${e}`)) continue;
        expect(nextState(s, e), `${s} ${e}`).toBeNull();
        refused++;
      }
    }
    expect(refused).toBe(STATES.length * EVENTS.length - legal.length);
    expect(nextState('draft', 'approve')).toBeNull();
    expect(nextState('agent_review', 'approve')).toBeNull();
    expect(nextState('submitted', 'review_pass')).toBeNull();
    expect(nextState('withdrawn', 'submit')).toBeNull();
  });
});

describe('parseDraft', () => {
  it('keeps only the draft fields: forged status, audience, approval, agent and creator fields are dropped', () => {
    const r = parseDraft({ ...article, status: 'published', audience: 'kids', world_approval: 'auto', agent_id: 1, created_by: 'admin' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of ['status', 'audience', 'world_approval', 'agent_id', 'created_by']) expect(r.value).not.toHaveProperty(k);
  });

  it('refuses the Kids world', () => {
    const r = parseDraft({ ...article, world: 'kids' });
    expect(r.ok).toBe(false);
  });

  it('caps lengths and counts', () => {
    expect(parseDraft({ ...article, title: 'x'.repeat(141) }).ok).toBe(false);
    expect(parseDraft({ ...article, summary: 'x'.repeat(301) }).ok).toBe(false);
    const big = 'x'.repeat(4001);
    expect(parseDraft({ ...article, sections: [{ heading: 'a', text: big }, { heading: 'b', text: big }] }).ok).toBe(false);
    const src = { title: 'S', url: 'https://example.org/a' };
    expect(parseDraft({ ...article, sources: Array(7).fill(src) }).ok).toBe(false);
    expect(parseDraft({ ...article, sources: Array(6).fill(src) }).ok).toBe(true);
    expect(parseDraft({ ...quiz, explanation: 'x'.repeat(501) }).ok).toBe(false);
    expect(parseDraft({ ...quiz, options: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(false);
  });

  it('refuses a source that is not https or is on this site', () => {
    expect(parseDraft({ ...article, sources: [{ title: 'x', url: 'http://example.org/' }] }).ok).toBe(false);
    expect(parseDraft({ ...article, sources: [{ title: 'x', url: 'https://sparkkindly.com/play/x/' }] }).ok).toBe(false);
  });

  it('keeps text plain: control characters dropped, one-line fields folded', () => {
    const r = parseDraft({ ...article, title: 'Why\nthe​ sky <b>is</b>' });
    expect(r.ok && r.value.title).toBe('Why the sky <b>is</b>');
  });
});

describe('toSubmission', () => {
  const ref = (content: unknown, kind: 'article' | 'quiz') => {
    const r = parseDraft(content);
    if (!r.ok) throw new Error(r.errors.join());
    return { id: '11111111-1111-4111-8111-111111111111', kind, slug: 'a-slug-abc123', world: r.value.world, revision: 1, content: r.value };
  };

  it('maps an article to the item format, audience all, paragraphs split on blank lines', () => {
    const sub = toSubmission(ref(article, 'article'), NOW);
    expect(itemSubmissionSchema.safeParse(sub).success).toBe(true);
    expect(sub.audience).toBe('all');
    expect(sub.kind === 'article' && sub.body.sections[0].paragraphs).toEqual(['Sunlight holds every colour.', 'Blue light scatters more.']);
    expect(sub.sources[0]).toEqual({ title: 'NASA', url: 'https://science.nasa.gov/sky', accessedAt: '2026-11-05' });
  });

  it('maps a quiz to multiple_choice with the answer beside the body', () => {
    const sub = toSubmission(ref(quiz, 'quiz'), NOW);
    expect(itemSubmissionSchema.safeParse(sub).success).toBe(true);
    expect(sub.kind === 'quiz' && sub.answer.value).toBe('b');
    expect(JSON.stringify(sub.kind === 'quiz' && sub.body)).not.toContain('Jupiter is more');
  });

  it('an incomplete article fails the item schema (the submit gate names it)', () => {
    const sub = toSubmission(ref({ ...article, sections: [article.sections[0]] }, 'article'), NOW);
    expect(itemSubmissionSchema.safeParse(sub).success).toBe(false);
  });
});

describe('profile fields', () => {
  it('display name: comment-name checks and reserved names', () => {
    expect(cleanContributorName('Ada L')).toBe('Ada L');
    for (const bad of ['', 'x'.repeat(31), 'admin', 'Spark Kindly', 'me@example.test', 'www.example.com']) {
      expect(cleanContributorName(bad), bad).toBeNull();
    }
  });

  it('bio: optional, up to 140, no links', () => {
    expect(cleanBio('')).toBeNull();
    expect(cleanBio('I like maps.')).toBe('I like maps.');
    expect(cleanBio('x'.repeat(141))).toBe(false);
    expect(cleanBio('see example.com')).toBe(false);
  });

  it('link: optional, https only, off this site', () => {
    expect(cleanLink('')).toBeNull();
    expect(cleanLink('https://example.org/me')).toBe('https://example.org/me');
    expect(cleanLink('http://example.org/')).toBe(false);
    expect(cleanLink('javascript:alert(1)')).toBe(false);
    expect(cleanLink('https://sparkkindly.com/')).toBe(false);
  });

  it('slugs: random profile id; item slug from the title with a suffix', () => {
    expect(newProfileSlug()).toMatch(/^[a-z0-9]{10}$/);
    expect(newProfileSlug()).not.toBe(newProfileSlug());
    expect(newItemSlug('Why the Sky is Blue!')).toMatch(/^why-the-sky-is-blue-[a-z0-9]{6}$/);
    expect(newItemSlug('???')).toMatch(/^contribution-[a-z0-9]{6}$/);
  });
});

describe('limits', () => {
  it('10 saves an hour and 5 submissions a day per account', () => {
    let t = 0;
    const l = createContributorLimits(() => t);
    for (let i = 0; i < CONTRIBUTOR_LIMITS.savesPerHour; i++) expect(l.save('a')).toBe(true);
    expect(l.save('a')).toBe(false);
    expect(l.save('b')).toBe(true);
    for (let i = 0; i < CONTRIBUTOR_LIMITS.submitsPerDay; i++) expect(l.submit('a')).toBe(true);
    expect(l.submit('a')).toBe(false);
    t += 60 * 60_000;
    expect(l.save('a')).toBe(true);
    expect(l.submit('a')).toBe(false);
    t += 24 * 60 * 60_000;
    expect(l.submit('a')).toBe(true);
  });
});
