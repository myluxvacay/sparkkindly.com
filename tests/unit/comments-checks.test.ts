// Comments (plan 7A Task 1): the mechanical checks every comment passes, in order, each with its own refusal code.
import { describe, it, expect, vi } from 'vitest';
import { checkComment } from '@/lib/comments/checks';
import { COMMENT_LIMITS, TRUST_THRESHOLD, cleanDisplayName, normaliseBody } from '@/lib/comments/rules';
import { commentsEnabled } from '@/lib/config';

const quiet = { sameBodyByAuthor24h: false, sameBodyOnItem: false, last10min: 0, last24h: 0 };
const check = (body: unknown, trustLevel: 0 | 1 = 0, recent = quiet) => checkComment({ body, trustLevel, recent });

describe('commentsEnabled', () => {
  it('needs both ACCOUNTS_ENABLED and COMMENTS_ENABLED set to true or 1', () => {
    for (const [accounts, comments, on] of [
      ['true', 'true', true],
      ['1', '1', true],
      ['true', '', false],
      ['', 'true', false],
      ['true', 'yes', false],
    ] as const) {
      vi.stubEnv('ACCOUNTS_ENABLED', accounts);
      vi.stubEnv('COMMENTS_ENABLED', comments);
      expect(commentsEnabled(), `${accounts}/${comments}`).toBe(on);
    }
    vi.unstubAllEnvs();
  });
});

describe('constants', () => {
  it('match the plan', () => {
    expect(COMMENT_LIMITS).toMatchObject({ body: 1000, name: 30, per10min: 5, perDay: 40, editMs: 15 * 60_000 });
    expect(TRUST_THRESHOLD).toBe(5);
  });
});

describe('length', () => {
  it('accepts 1 and 1000 characters after NFKC and trim, refuses 0 and 1001', () => {
    expect(check('')).toEqual({ ok: false, code: 'length' });
    expect(check('   \n ')).toEqual({ ok: false, code: 'length' });
    expect(check('a')).toEqual({ ok: true, body: 'a', hasLink: false });
    expect(check(`  ${'a'.repeat(1000)}  `)).toMatchObject({ ok: true });
    expect(check('a'.repeat(1001))).toEqual({ ok: false, code: 'length' });
    expect(check(42)).toEqual({ ok: false, code: 'length' });
    expect(check(null)).toEqual({ ok: false, code: 'length' });
  });

  it('counts characters, not UTF-16 units, and normalises with NFKC', () => {
    expect(check('😀'.repeat(1000))).toMatchObject({ ok: true });
    expect(check('Ｈｅｌｌｏ')).toEqual({ ok: true, body: 'Hello', hasLink: false });
  });

  it('keeps line breaks, drops other control and format characters', () => {
    expect(normaliseBody(' one\r\ntwo​\u0007 ')).toBe('one\ntwo');
    expect(normaliseBody(5)).toBeNull();
  });
});

describe('blocked words, duplicates and rate limits', () => {
  it('refuses a blocked word, including behind a zero-width character or fullwidth letters', () => {
    expect(check('this is shit')).toEqual({ ok: false, code: 'blocked' });
    expect(check('this is sh​it')).toEqual({ ok: false, code: 'blocked' });
    expect(check('this is ｓｈｉｔ')).toEqual({ ok: false, code: 'blocked' });
  });

  it('refuses a duplicate by the same author in 24 hours or the same body on the item', () => {
    expect(check('hello', 1, { ...quiet, sameBodyByAuthor24h: true })).toEqual({ ok: false, code: 'duplicate' });
    expect(check('hello', 1, { ...quiet, sameBodyOnItem: true })).toEqual({ ok: false, code: 'duplicate' });
  });

  it('refuses the sixth comment in 10 minutes and the 41st in a day', () => {
    expect(check('hello', 1, { ...quiet, last10min: 4, last24h: 39 })).toMatchObject({ ok: true });
    expect(check('hello', 1, { ...quiet, last10min: 5 })).toEqual({ ok: false, code: 'rate' });
    expect(check('hello', 1, { ...quiet, last24h: 40 })).toEqual({ ok: false, code: 'rate' });
  });

  it('runs the checks in order: rate, length, blocked, duplicate, link', () => {
    const all = { sameBodyByAuthor24h: true, sameBodyOnItem: true, last10min: 9, last24h: 99 };
    expect(check('', 0, all)).toEqual({ ok: false, code: 'rate' });
    expect(check('', 0, { ...all, last10min: 0, last24h: 0 })).toEqual({ ok: false, code: 'length' });
    expect(check('shit www.x.com', 0, { ...quiet, sameBodyOnItem: true })).toEqual({ ok: false, code: 'blocked' });
    expect(check('see www.x.com', 0, { ...quiet, sameBodyOnItem: true })).toEqual({ ok: false, code: 'duplicate' });
  });
});

describe('link policy', () => {
  const links = [
    'go to https://evil.example',
    'visit www.evil',
    'evil.com is great',
    'evil．com is great',
    'evil。com is great',
    'evil.ćom is great',
    'e̲vil.c̲o̲m',
    'evil​.com',
  ];
  it('refuses any link-like text below level 1', () => {
    for (const body of links) expect(check(body, 0), body).toEqual({ ok: false, code: 'link' });
  });
  it('accepts it at level 1, flagged so it is shown as plain text', () => {
    for (const body of links) expect(check(body, 1), body).toMatchObject({ ok: true, hasLink: true });
  });
  it('leaves ordinary sentences alone', () => {
    expect(check('I loved this. Thank you!', 0)).toMatchObject({ ok: true, hasLink: false });
  });
});

describe('cleanDisplayName', () => {
  it('takes 1 to 30 characters after NFKC, no @, no blocked word, nothing link-like', () => {
    expect(cleanDisplayName('  Ｓam ')).toBe('Sam');
    expect(cleanDisplayName('a'.repeat(30))).toBe('a'.repeat(30));
    for (const bad of ['', 'a'.repeat(31), 'sam@example', 'shit', 'evil.com', 42]) expect(cleanDisplayName(bad)).toBeNull();
  });
});

describe('7A review fixes: hidden marks, blank-looking text and reserved names', () => {
  it('L2: a blocked word hidden behind combining marks is refused; ordinary accented text is accepted', () => {
    expect(check('f\u0301uck this')).toEqual({ ok: false, code: 'blocked' });
    expect(check('s\u0308hit happens')).toEqual({ ok: false, code: 'blocked' });
    expect(check('Un café crème, très bien')).toMatchObject({ ok: true });
    expect(check('Ein schöner Tag, naïve façade')).toMatchObject({ ok: true });
  });

  it('L2: Hangul fillers and other default-ignorable characters count as nothing in a body and are refused in a name', () => {
    for (const blank of ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u3164 \u3164', '\u034F']) {
      expect(check(blank), JSON.stringify(blank)).toEqual({ ok: false, code: 'length' });
      expect(cleanDisplayName(blank), JSON.stringify(blank)).toBeNull();
    }
    expect(normaliseBody('hi\u3164there')).toBe('hithere');
    expect(cleanDisplayName('Sam\u3164')).toBeNull();
    expect(cleanDisplayName('Zoë')).toBe('Zoë');
  });

  it('L3: reserved display names are refused, whatever the case or spacing', () => {
    for (const name of ['SparkKindly', 'spark kindly', 'SPARK  KINDLY', 'Admin', 'administrator', 'Moderator', 'mod', 'Owner', 'staff', 'Support', 'TEAM', 'Ａｄｍｉｎ']) {
      expect(cleanDisplayName(name), name).toBeNull();
    }
    for (const name of ['Modest', 'Teamwork fan', 'Sam the admin fan']) expect(cleanDisplayName(name), name).not.toBeNull();
  });
});
