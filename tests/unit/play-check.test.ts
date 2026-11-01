import { describe, it, expect } from 'vitest';
import { parseGiven, checkAnswer, describeAnswer } from '@/lib/play/check';

const q = (o: Record<string, string>) => new URLSearchParams(o);

describe('multiple_choice and odd_one_out', () => {
  for (const m of ['multiple_choice', 'odd_one_out'] as const) {
    it(`${m}: id right, wrong, malformed`, () => {
      expect(checkAnswer(m, 'b', parseGiven(m, q({ r: 'b' })))).toBe(true);
      expect(checkAnswer(m, 'b', parseGiven(m, q({ r: 'c' })))).toBe(false);
      expect(parseGiven(m, q({}))).toBeNull();
      expect(parseGiven(m, q({ r: '' }))).toBeNull();
      expect(parseGiven(m, q({ r: 'x'.repeat(201) }))).toBeNull();
    });
  }
});

describe('true_false', () => {
  it('parses and checks', () => {
    expect(checkAnswer('true_false', true, parseGiven('true_false', q({ r: 'true' })))).toBe(true);
    expect(checkAnswer('true_false', true, parseGiven('true_false', q({ r: 'false' })))).toBe(false);
    expect(checkAnswer('true_false', false, parseGiven('true_false', q({ r: 'false' })))).toBe(true);
    expect(parseGiven('true_false', q({ r: 'yes' }))).toBeNull();
    expect(parseGiven('true_false', q({}))).toBeNull();
  });
});

describe('short_text and clue_reveal', () => {
  const stored = { accepted: ['Mount Everest', 'Everest'] };
  for (const m of ['short_text', 'clue_reveal'] as const) {
    it(`${m}: variants, case, spacing, punctuation`, () => {
      const ok = (r: string) => checkAnswer(m, stored, parseGiven(m, q({ r })));
      expect(ok('everest')).toBe(true);
      expect(ok('  MOUNT   everest ')).toBe(true);
      expect(ok('Everest!')).toBe(true);
      expect(ok('K2')).toBe(false);
      expect(parseGiven(m, q({ r: '   ' }))).toBeNull();
      expect(parseGiven(m, q({ r: 'a'.repeat(201) }))).toBeNull();
      expect(parseGiven(m, q({}))).toBeNull();
    });
  }
  it('a malformed stored answer never matches', () => {
    expect(checkAnswer('short_text', null, 'x')).toBe(false);
    expect(checkAnswer('short_text', { accepted: 'x' }, 'x')).toBe(false);
  });
});

describe('number', () => {
  const stored = { value: 10, tolerance: 0.5 };
  const ok = (r: string) => {
    const g = parseGiven('number', q({ r }));
    return g === null ? null : checkAnswer('number', stored, g);
  };
  it('inside, on and outside tolerance', () => {
    expect(ok('10.3')).toBe(true);
    expect(ok('10.5')).toBe(true);
    expect(ok('9.5')).toBe(true);
    expect(ok('10.6')).toBe(false);
  });
  it('rejects non-numbers', () => {
    for (const r of ['abc', 'NaN', 'Infinity', '-Infinity', '', ' ']) expect(ok(r)).toBeNull();
  });
});

describe('put_in_order', () => {
  const ids = ['a', 'b', 'c'];
  const stored = ['b', 'a', 'c'];
  const given = (o: Record<string, string>) => parseGiven('put_in_order', q(o), ids);
  it('valid order is checked', () => {
    expect(checkAnswer('put_in_order', stored, given({ 'pos-b': '1', 'pos-a': '2', 'pos-c': '3' }))).toBe(true);
    expect(checkAnswer('put_in_order', stored, given({ 'pos-a': '1', 'pos-b': '2', 'pos-c': '3' }))).toBe(false);
  });
  it('malformed is null', () => {
    expect(given({ 'pos-a': '1', 'pos-b': '1', 'pos-c': '2' })).toBeNull(); // duplicate
    expect(given({ 'pos-a': '1', 'pos-b': '2' })).toBeNull(); // missing
    expect(given({ 'pos-a': '1', 'pos-b': '2', 'pos-c': '4' })).toBeNull(); // out of range
    expect(given({ 'pos-a': '1', 'pos-b': '2', 'pos-c': 'x' })).toBeNull();
    expect(given({ 'pos-a': '1', 'pos-b': '2', 'pos-c': '3', 'pos-zzz': '4' })).toBeNull(); // unknown id
    expect(parseGiven('put_in_order', q({ 'pos-a': '1' }))).toBeNull(); // no item ids
  });
});

describe('describeAnswer', () => {
  const body = {
    options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }],
    items: [{ id: 'x', text: 'First' }, { id: 'y', text: 'Second' }],
  };
  it('gives human text', () => {
    expect(describeAnswer(body, 'b')).toBe('Beta');
    expect(describeAnswer(body, 'x')).toBe('First');
    expect(describeAnswer(body, ['y', 'x'])).toBe('Second, First');
    expect(describeAnswer(body, { accepted: ['Everest', 'Mount Everest'] })).toBe('Everest');
    expect(describeAnswer(body, { value: 10, tolerance: 1 })).toBe('10');
    expect(describeAnswer(body, true)).toBe('True');
    expect(describeAnswer(body, false)).toBe('False');
  });
});
