// Sponsorship rules (plan 6 Task 1): who may see a sponsor line, which items may carry one, the fixed disclosure
// sentences, and the validation of sponsors and sponsorships the owner enters in /admin. Pure functions, no database.
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_CATEGORIES,
  EXCLUDED_CATEGORIES,
  disclosureFor,
  validateSponsor,
  validateSponsorship,
} from '@/lib/sponsorship/rules';
import { itemMayCarrySponsorship, viewerMaySeeSponsorship, type SponsorViewer } from '@/lib/sponsorship/eligibility';

describe('viewerMaySeeSponsorship', () => {
  const rows: [string, SponsorViewer, boolean][] = [
    ['anonymous', { kind: 'anonymous' }, true],
    ['adult account', { kind: 'account', group: 'adult', consent: 'none', profile: false }, true],
    ['adult with a child profile active', { kind: 'account', group: 'adult', consent: 'none', profile: true }, false],
    ['16-17', { kind: 'account', group: 'teen_16_17', consent: 'none', profile: false }, false],
    ['13-15 confirmed', { kind: 'account', group: 'teen_13_15', consent: 'confirmed', profile: false }, false],
    ['13-15 pending', { kind: 'account', group: 'teen_13_15', consent: 'pending', profile: false }, false],
    ['under 13', { kind: 'account', group: 'under_13', consent: 'none', profile: false }, false],
    ['unknown (lookup error)', { kind: 'unknown' }, false],
  ];
  it.each(rows)('%s', (_name, viewer, expected) => {
    expect(viewerMaySeeSponsorship(viewer)).toBe(expected);
  });

  it('fails closed on anything it does not recognise', () => {
    expect(viewerMaySeeSponsorship({ kind: 'other' } as unknown as SponsorViewer)).toBe(false);
    expect(viewerMaySeeSponsorship(null as unknown as SponsorViewer)).toBe(false);
    expect(viewerMaySeeSponsorship({ kind: 'account', group: 'grown-up', consent: 'none', profile: false } as unknown as SponsorViewer)).toBe(false);
  });
});

describe('itemMayCarrySponsorship', () => {
  const ok = { audience: 'adults', worldSlug: 'grow', riskTier: 'reflective', status: 'published' };
  it('only a published adults item outside Kids', () => {
    expect(itemMayCarrySponsorship(ok)).toBe(true);
    expect(itemMayCarrySponsorship({ ...ok, audience: 'all' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, audience: 'kids' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, worldSlug: 'kids' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, riskTier: 'kids' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, status: 'draft' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, status: 'archived' })).toBe(false);
    expect(itemMayCarrySponsorship({ ...ok, status: 'scheduled' })).toBe(false);
  });
});

describe('disclosureFor', () => {
  it('is one fixed sentence per kind and target type', () => {
    expect(disclosureFor('affiliate', 'topic', 'Acme')).toBe('SparkKindly earns a commission if you buy through this link.');
    expect(disclosureFor('affiliate', 'item', 'Acme')).toBe('SparkKindly earns a commission if you buy through this link.');
    expect(disclosureFor('supported', 'topic', 'Acme')).toBe('This topic is supported by Acme. Acme had no say in what we publish.');
    expect(disclosureFor('supported', 'world', 'Acme')).toBe('This section is supported by Acme. Acme had no say in what we publish.');
    expect(disclosureFor('supported', 'item', 'Acme')).toBe('This piece is supported by Acme. Acme had no say in what we publish.');
  });
});

describe('validateSponsor', () => {
  const good = { name: 'Acme Books', link: 'https://acme.example/books', category: 'books', confirmed: 'on' };

  it('accepts a sponsor in an allowed category with the confirmation', () => {
    expect(validateSponsor(good)).toEqual({ ok: true, value: { name: 'Acme Books', link: 'https://acme.example/books', category: 'books' } });
  });

  it('lists the excluded categories and never allows one', () => {
    expect(EXCLUDED_CATEGORIES.length).toBe(10);
    for (const c of EXCLUDED_CATEGORIES) {
      expect(ALLOWED_CATEGORIES).not.toContain(c);
      expect(validateSponsor({ ...good, category: c }).ok).toBe(false);
    }
  });

  it.each([
    ['http link', { link: 'http://acme.example/' }],
    ['credentials in the link', { link: 'https://user:pw@acme.example/' }],
    ['private address', { link: 'https://127.0.0.1/' }],
    ['localhost', { link: 'https://localhost/' }],
    ['not a URL', { link: 'acme' }],
    ['81-character name', { name: 'x'.repeat(81) }],
    ['empty name', { name: '   ' }],
    ['unknown category', { category: 'cars' }],
    ['missing category', { category: undefined }],
    ['missing confirmation', { confirmed: undefined }],
    ['name not a string', { name: ['a'] }],
  ])('rejects %s', (_name, change) => {
    expect(validateSponsor({ ...good, ...change }).ok).toBe(false);
  });

  it('accepts an 80-character name', () => {
    expect(validateSponsor({ ...good, name: 'x'.repeat(80) }).ok).toBe(true);
  });
});

describe('validateSponsorship', () => {
  const good = { sponsorId: '3', target: 'topic', targetRef: 'money', label: 'Try Acme budgeting', kind: 'supported' };

  it('accepts one target, a label and a kind, with optional UTC dates', () => {
    expect(validateSponsorship({ ...good, startsOn: '2026-11-01', endsOn: '2026-11-30' })).toEqual({
      ok: true,
      value: { sponsorId: 3, target: 'topic', targetRef: 'money', label: 'Try Acme budgeting', kind: 'supported', startsOn: '2026-11-01', endsOn: '2026-11-30' },
    });
    expect(validateSponsorship(good)).toMatchObject({ ok: true, value: { startsOn: null, endsOn: null } });
  });

  it.each([
    ['61-character label', { label: 'x'.repeat(61) }],
    ['empty label', { label: '' }],
    ['unknown kind', { kind: 'banner' }],
    ['unknown target', { target: 'circle' }],
    ['missing target ref', { targetRef: '' }],
    ['bad sponsor id', { sponsorId: 'x' }],
    ['bad start date', { startsOn: '2026-02-30' }],
    ['end before start', { startsOn: '2026-11-10', endsOn: '2026-11-09' }],
  ])('rejects %s', (_name, change) => {
    expect(validateSponsorship({ ...good, ...change }).ok).toBe(false);
  });

  it('accepts a 60-character label', () => {
    expect(validateSponsorship({ ...good, label: 'x'.repeat(60) }).ok).toBe(true);
  });
});
