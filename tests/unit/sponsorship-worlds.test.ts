// @vitest-environment node
// Sponsorship only in Save, Grow and Discover (owner decision, 8 November 2026): never Play, Together or Kids. Covers the
// item rule, the standalone world card, the click counter and the admin attach refusal, on PGlite.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { itemMayCarrySponsorship, SPONSOR_WORLDS, type SponsorViewer } from '@/lib/sponsorship/eligibility';
import { worldSponsorFor, sponsorFor } from '@/lib/sponsorship/select';
import { recordClick } from '@/lib/sponsorship/clicks';
import { attachSponsorship } from '@/lib/sponsorship/admin';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const TODAY = '2026-11-05';
const NOW = new Date('2026-11-05T12:00:00Z');
const ANON: SponsorViewer = { kind: 'anonymous' };
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => db.close());
beforeEach(() => vi.stubEnv('SPONSORSHIP_ENABLED', 'true'));

const sponsor = async () =>
  (await db.query<{ id: number }>(
    `INSERT INTO sponsors (name, link, disclosure, category, confirmed_at) VALUES ('Acme', 'https://acme.example/', '', 'finance-education', $1) RETURNING id`,
    [NOW],
  )).rows[0].id;
const attachWorld = async (world: string, kind = 'affiliate', over: { endsOn?: string; ended?: boolean } = {}) =>
  (await db.query<{ id: number }>(
    `INSERT INTO sponsorships (sponsor_id, world_id, label, kind, ends_on, ended_at)
     VALUES ($1, (SELECT id FROM worlds WHERE slug = $2), 'See the offer', $3, $4, $5) RETURNING id`,
    [await sponsor(), world, kind, over.endsOn ?? null, over.ended ? NOW : null],
  )).rows[0].id;
const item = async (world: string, audience = 'adults') =>
  (await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     SELECT id, 'article', $2, 'T', 'S', '{}'::jsonb, $3, 'published', '2026-11-01T00:00:00Z', 'test', 'reflective', 'owner'
     FROM worlds WHERE slug = $1 RETURNING id`,
    [world, `spw-${n++}`, audience],
  )).rows[0].id;

describe('which worlds may carry sponsorship', () => {
  it('lists exactly Save, Grow and Discover', () => expect([...SPONSOR_WORLDS].sort()).toEqual(['discover', 'grow', 'save']));
  const base = { audience: 'adults', riskTier: 'reflective', status: 'published' };
  it.each(['save', 'grow', 'discover'])('an adults item in %s may carry it', (w) => expect(itemMayCarrySponsorship({ ...base, worldSlug: w })).toBe(true));
  it.each(['play', 'together', 'kids'])('an adults item in %s never does', (w) => expect(itemMayCarrySponsorship({ ...base, worldSlug: w })).toBe(false));
});

describe('the item line follows the same worlds', () => {
  it('a world sponsorship shows on a Save article but not on a Play article', async () => {
    await attachWorld('save');
    await attachWorld('play');
    expect(await sponsorFor(db, await item('save'), TODAY)).not.toBeNull();
    expect(await sponsorFor(db, await item('play'), TODAY)).toBeNull();
  });
});

describe('worldSponsorFor (the card on a world page)', () => {
  it('returns the world sponsorship with the fixed disclosure', async () => {
    const id = await attachWorld('grow', 'affiliate');
    expect(await worldSponsorFor(db, 'grow', TODAY)).toMatchObject({ id, kind: 'affiliate', disclosure: 'SparkKindly earns a commission if you buy through this link.' });
  });
  it.each(['play', 'together', 'kids'])('is null for %s even if a row exists', async (w) => {
    if (w !== 'kids') await attachWorld(w);
    expect(await worldSponsorFor(db, w, TODAY)).toBeNull();
  });
  it('is null once ended or past its end date', async () => {
    await db.query('DELETE FROM sponsorships');
    await attachWorld('discover', 'supported', { ended: true });
    await attachWorld('discover', 'supported', { endsOn: '2026-11-04' });
    expect(await worldSponsorFor(db, 'discover', TODAY)).toBeNull();
  });
  it('is null with the flag off', async () => {
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    await attachWorld('save');
    expect(await worldSponsorFor(db, 'save', TODAY)).toBeNull();
  });
});

describe('click counting for a world sponsorship', () => {
  it('counts in an allowed world and refuses one pointing at a world that may not carry it', async () => {
    const ok = await attachWorld('save');
    const bad = await attachWorld('play');
    expect(await recordClick(db, ok, TODAY, ANON)).toEqual({ url: 'https://acme.example/' });
    expect(await recordClick(db, bad, TODAY, ANON)).toBeNull();
    expect((await db.query<{ click_count: number }>('SELECT click_count FROM sponsorships WHERE id = $1', [bad])).rows[0].click_count).toBe(0);
  });
});

describe('admin attach', () => {
  const attach = async (world: string) => {
    const form = new URLSearchParams({ sponsor: String(await sponsor()), target: 'world', ref: world, label: 'See it', kind: 'supported' });
    return attachSponsorship(db, form);
  };
  it('accepts Save, Grow and Discover as world targets', async () => {
    for (const w of ['save', 'grow', 'discover']) expect(await attach(w)).toMatchObject({ ok: true });
  });
  it('refuses Play, Together and Kids', async () => {
    for (const w of ['play', 'together', 'kids']) expect(await attach(w)).toMatchObject({ ok: false });
  });
});

describe('loadWorldSponsor (flag and viewer gate)', () => {
  it('shows to an anonymous visitor in an allowed world, nothing in Kids or with the flag off', async () => {
    const { loadWorldSponsor } = await import('@/lib/sponsorship/web');
    await db.query('DELETE FROM sponsorships');
    const id = await attachWorld('save');
    expect(await loadWorldSponsor(db, undefined, 'save', NOW)).toMatchObject({ id });
    expect(await loadWorldSponsor(db, undefined, 'kids', NOW)).toBeNull();
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(await loadWorldSponsor(db, undefined, 'save', NOW)).toBeNull();
  });
});
