// @vitest-environment node
// Sponsorship selection and click counting (plan 6 Task 1), on PGlite: the one sponsor line an item may carry
// (precedence item > topic > world, then most recently started; inclusive UTC date windows; ended or unconfirmed
// sponsors never show), the session-to-viewer lookup that fails closed, and the atomic click counter.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { person } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { sponsorFor } from '@/lib/sponsorship/select';
import { recordClick } from '@/lib/sponsorship/clicks';
import { sponsorViewerForSession, type SponsorViewer } from '@/lib/sponsorship/eligibility';
import type { Db } from '@/lib/db';

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
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('SPONSORSHIP_ENABLED', 'true');
});

type ItemOpts = { world?: string; audience?: string; status?: string; riskTier?: string; topic?: string };
async function item(o: ItemOpts = {}): Promise<string> {
  const audience = o.audience ?? 'adults';
  const tier = o.riskTier ?? (audience === 'kids' || o.world === 'kids' ? 'kids' : 'reflective');
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     SELECT id, 'article', $2, 'T', 'S', '{}'::jsonb, $3, $4, '2026-11-01T00:00:00Z', 'test', $5, 'owner'
     FROM worlds WHERE slug = $1 RETURNING id`,
    [o.world ?? 'grow', `sp-item-${n++}`, audience, o.status ?? 'published', tier],
  );
  const id = r.rows[0].id;
  if (o.topic) {
    await db.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = $2', [id, o.topic]);
  }
  return id;
}

async function topic(): Promise<string> {
  const slug = `sp-topic-${n++}`;
  await db.query("INSERT INTO topics (slug, name) VALUES ($1, 'Money')", [slug]);
  return slug;
}

type SponsorOpts = { name?: string; link?: string; activeFrom?: string; activeTo?: string; confirmed?: boolean };
async function sponsor(o: SponsorOpts = {}): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO sponsors (name, link, disclosure, category, confirmed_at, active_from, active_to)
     VALUES ($1, $2, '', 'books', $3, $4, $5) RETURNING id`,
    [o.name ?? 'Acme', o.link ?? 'https://acme.example/', o.confirmed === false ? null : NOW, o.activeFrom ?? null, o.activeTo ?? null],
  );
  return r.rows[0].id;
}

type Target = { item?: string; topic?: string; world?: string };
type ShipOpts = { label?: string; kind?: string; startsOn?: string | null; endsOn?: string | null; ended?: boolean };
async function attach(sponsorId: number, t: Target, o: ShipOpts = {}): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO sponsorships (sponsor_id, item_id, topic_id, world_id, label, kind, starts_on, ends_on, ended_at)
     VALUES ($1, $2, (SELECT id FROM topics WHERE slug = $3), (SELECT id FROM worlds WHERE slug = $4), $5, $6, $7, $8, $9)
     RETURNING id`,
    [sponsorId, t.item ?? null, t.topic ?? null, t.world ?? null, o.label ?? 'Visit Acme', o.kind ?? 'supported',
      o.startsOn ?? null, o.endsOn ?? null, o.ended ? NOW : null],
  );
  return r.rows[0].id;
}

const clicks = async (id: number) =>
  (await db.query<{ click_count: number }>('SELECT click_count FROM sponsorships WHERE id = $1', [id])).rows[0].click_count;

describe('migration', () => {
  it('adds kind (default supported, checked), ended_at, category (allowed list only) and confirmed_at', async () => {
    const s = await sponsor();
    const w = await db.query<{ kind: string }>("INSERT INTO sponsorships (sponsor_id, world_id, label) SELECT $1, id, 'L' FROM worlds WHERE slug = 'grow' RETURNING kind", [s]);
    expect(w.rows[0].kind).toBe('supported');
    await db.query('UPDATE sponsorships SET ended_at = now() WHERE sponsor_id = $1', [s]);
    await expect(db.query("INSERT INTO sponsorships (sponsor_id, world_id, label, kind) SELECT $1, id, 'L', 'banner' FROM worlds WHERE slug = 'grow'", [s])).rejects.toThrow(/check/);
    await expect(db.query("INSERT INTO sponsors (name, link, category) VALUES ('G', 'https://g.example/', 'gambling')")).rejects.toThrow(/check/);
    await db.query("INSERT INTO sponsors (name, link) VALUES ('Legacy', 'https://l.example/')");
    await expect(db.query("INSERT INTO sponsors (name, link, confirmed_at) VALUES ('NoCat', 'https://n.example/', now())")).rejects.toThrow(/check/);
  });
});

describe('sponsorFor', () => {
  it('returns the line for a published adults item with a topic sponsorship', async () => {
    const t = await topic();
    const i = await item({ topic: t });
    const id = await attach(await sponsor({ name: 'Acme Money' }), { topic: t }, { label: 'Budget with Acme' });
    expect(await sponsorFor(db, i, TODAY)).toEqual({
      id,
      label: 'Budget with Acme',
      kind: 'supported',
      sponsorName: 'Acme Money',
      disclosure: 'This topic is supported by Acme Money. Acme Money had no say in what we publish.',
    });
  });

  it('never for an all, kids, Kids-world, kids-tier, draft or archived item', async () => {
    const t = await topic();
    await attach(await sponsor(), { topic: t });
    const ineligible = [
      await item({ topic: t, audience: 'all' }),
      await item({ topic: t, world: 'kids', audience: 'all' }),
      await item({ topic: t, status: 'draft' }),
      await item({ topic: t, status: 'archived' }),
    ];
    for (const i of ineligible) expect(await sponsorFor(db, i, TODAY)).toBeNull();
    // A Kids-world item is kids tier by the schema's own safety rule, so it is covered by the row above.
    expect(await sponsorFor(db, '00000000-0000-0000-0000-000000000000', TODAY)).toBeNull();
    expect(await sponsorFor(db, 'not-a-uuid', TODAY)).toBeNull();
  });

  it('prefers item over topic over world, then the most recently started', async () => {
    const t = await topic();
    const i = await item({ world: 'together', topic: t });
    const s = await sponsor();
    const w = await attach(s, { world: 'together' });
    expect((await sponsorFor(db, i, TODAY))?.id).toBe(w);
    const older = await attach(s, { topic: t }, { startsOn: '2026-10-01' });
    const newer = await attach(s, { topic: t }, { startsOn: '2026-11-01' });
    expect((await sponsorFor(db, i, TODAY))?.id).toBe(newer);
    expect(older).toBeLessThan(newer);
    const direct = await attach(s, { item: i }, { kind: 'affiliate' });
    expect(await sponsorFor(db, i, TODAY)).toMatchObject({ id: direct, disclosure: 'SparkKindly earns a commission if you buy through this link.' });
  });

  it('shows on ends_on, not the day after; not before starts_on; respects the sponsor window and ended_at', async () => {
    const i = await item();
    const s = await sponsor();
    const id = await attach(s, { item: i }, { startsOn: '2026-11-01', endsOn: TODAY });
    expect((await sponsorFor(db, i, TODAY))?.id).toBe(id);
    expect(await sponsorFor(db, i, '2026-11-06')).toBeNull();
    expect(await sponsorFor(db, i, '2026-10-31')).toBeNull();

    const j = await item();
    await attach(await sponsor({ activeFrom: '2026-11-06' }), { item: j });
    expect(await sponsorFor(db, j, TODAY)).toBeNull();
    const k = await item();
    await attach(await sponsor({ activeTo: '2026-11-04' }), { item: k });
    expect(await sponsorFor(db, k, TODAY)).toBeNull();
    const l = await item();
    await attach(s, { item: l }, { ended: true });
    expect(await sponsorFor(db, l, TODAY)).toBeNull();
  });

  it('never for a sponsor without the recorded confirmation', async () => {
    const i = await item();
    await attach(await sponsor({ confirmed: false }), { item: i });
    expect(await sponsorFor(db, i, TODAY)).toBeNull();
  });

  it('returns exactly one result, and nothing with the flag off', async () => {
    const t = await topic();
    const i = await item({ topic: t });
    for (let k = 0; k < 3; k++) await attach(await sponsor(), { topic: t });
    expect(await sponsorFor(db, i, TODAY)).not.toBeNull();
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(await sponsorFor(db, i, TODAY)).toBeNull();
  });
});

describe('recordClick', () => {
  it('increments exactly once per call and returns the stored link', async () => {
    const i = await item();
    const id = await attach(await sponsor({ link: 'https://acme.example/offer' }), { item: i });
    expect(await recordClick(db, id, TODAY, ANON)).toEqual({ url: 'https://acme.example/offer' });
    expect(await clicks(id)).toBe(1);
    await recordClick(db, id, TODAY, { kind: 'account', group: 'adult', consent: 'none', profile: false });
    expect(await clicks(id)).toBe(2);
  });

  it('returns null and counts nothing for an ineligible viewer, an inactive or missing sponsorship', async () => {
    const i = await item();
    const s = await sponsor();
    const id = await attach(s, { item: i });
    const viewers: SponsorViewer[] = [
      { kind: 'unknown' },
      { kind: 'account', group: 'adult', consent: 'none', profile: true },
      { kind: 'account', group: 'teen_16_17', consent: 'none', profile: false },
      { kind: 'account', group: 'teen_13_15', consent: 'pending', profile: false },
    ];
    for (const v of viewers) expect(await recordClick(db, id, TODAY, v)).toBeNull();
    expect(await clicks(id)).toBe(0);

    const ended = await attach(s, { item: i }, { ended: true });
    const later = await attach(s, { item: i }, { startsOn: '2026-12-01' });
    expect(await recordClick(db, ended, TODAY, ANON)).toBeNull();
    expect(await recordClick(db, later, TODAY, ANON)).toBeNull();
    expect(await recordClick(db, 999_999, TODAY, ANON)).toBeNull();
    expect(await recordClick(db, 'https://evil.example/' as unknown as number, TODAY, ANON)).toBeNull();
    expect(await clicks(ended)).toBe(0);
    expect(await clicks(later)).toBe(0);
  });

  it('refuses an item sponsorship whose item no longer qualifies, and with the flag off', async () => {
    const i = await item();
    const id = await attach(await sponsor(), { item: i });
    await db.query("UPDATE items SET status = 'archived' WHERE id = $1", [i]);
    expect(await recordClick(db, id, TODAY, ANON)).toBeNull();
    await db.query("UPDATE items SET status = 'published' WHERE id = $1", [i]);
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(await recordClick(db, id, TODAY, ANON)).toBeNull();
    expect(await clicks(id)).toBe(0);
  });

  it('re-checks the stored link before counting: an unsafe one sends nobody and counts nothing', async () => {
    for (const link of ['http://acme.example/', 'https://127.0.0.1/', 'https://acme.example/a\nb', 'not a url']) {
      const t = await topic();
      const id = await attach(await sponsor({ link }), { topic: t });
      expect(await recordClick(db, id, TODAY, ANON), link).toBeNull();
      expect(await clicks(id), link).toBe(0);
    }
  });

  it('returns a stored non-ASCII link (from before normalisation) in its ASCII form', async () => {
    const t = await topic();
    const id = await attach(await sponsor({ link: 'https://bücher.example/ä' }), { topic: t });
    expect(await recordClick(db, id, TODAY, ANON)).toEqual({ url: 'https://xn--bcher-kva.example/%C3%A4' });
    expect(await clicks(id)).toBe(1);
  });

  it('counts every one of concurrent calls', async () => {
    const t = await topic();
    const id = await attach(await sponsor(), { topic: t });
    await Promise.all(Array.from({ length: 20 }, () => recordClick(db, id, TODAY, ANON)));
    expect(await clicks(id)).toBe(20);
  });
});

describe('sponsorViewerForSession', () => {
  it('anonymous without a cookie or with a stale one; the account context with a valid one', async () => {
    expect(await sponsorViewerForSession(db, undefined, NOW)).toEqual({ kind: 'anonymous' });
    expect(await sponsorViewerForSession(db, 'stale-token', NOW)).toEqual({ kind: 'anonymous' });
    const adult = await person(db, NOW);
    expect(await sponsorViewerForSession(db, adult.session, NOW)).toEqual({ kind: 'account', group: 'adult', consent: 'none', profile: false });
    const teen = await person(db, NOW, '2010-01-01');
    expect(await sponsorViewerForSession(db, teen.session, NOW)).toMatchObject({ kind: 'account', group: 'teen_16_17' });
  });

  it('unknown when the lookup throws', async () => {
    const broken = { query: () => Promise.reject(new Error('down')) } as unknown as Db;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sponsorViewerForSession(broken, 'a'.repeat(64), NOW)).toEqual({ kind: 'unknown' });
    spy.mockRestore();
  });
});
