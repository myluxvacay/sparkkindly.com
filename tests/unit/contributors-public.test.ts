// @vitest-environment node
// What the public sees of contributions (plan 8 Task 3): the byline on published contributed items only, the
// contributor page, JSON-LD author, the sitemap entries, and nothing at all with the flag off.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { contributor, stateOf, submitted } from '../helpers/contributors';
import { person } from '../helpers/comments';
import { bylineFor, contributorPage, contributorSlugs } from '@/lib/contributors/byline';
import { enableContributor, getProfile } from '@/lib/contributors/profile';
import { withdraw } from '@/lib/contributors/submit';
import { articleLd } from '@/lib/public/jsonld';
import { anonymousScope } from '@/lib/public/scope';
import type { PublicItem } from '@/lib/items/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const scope = () => anonymousScope(NOW);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CONTRIBUTORS_ENABLED', 'true');
});

async function published(p: Awaited<ReturnType<typeof contributor>>) {
  const id = await submitted(db, p, NOW);
  const itemId = (await stateOf(db, id)).item_id!;
  await db.query("UPDATE contributions SET state = 'approved' WHERE id = $1", [id]);
  await db.query("UPDATE items SET status = 'published', published_at = $2, approved_by = 'owner' WHERE id = $1", [itemId, new Date(NOW.getTime() - 60_000)]);
  return { id, itemId };
}

describe('byline', () => {
  it('shows the display name and the random page id for a published contributed item only', async () => {
    const p = await contributor(db, NOW);
    const { itemId } = await published(p);
    const prof = (await getProfile(db, p.id))!;
    expect(await bylineFor(db, itemId)).toEqual({ name: prof.displayName, slug: prof.slug });
    expect(JSON.stringify(await bylineFor(db, itemId))).not.toContain(p.email);
    const pending = await submitted(db, p, NOW);
    expect(await bylineFor(db, (await stateOf(db, pending)).item_id!)).toBeNull();
    const plain = (await db.query<{ id: string }>("INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by) SELECT id, 'article', 'agent-made', 'T', 'S', '{}', 'all', 'published', now(), 'agent', 'reflective', 'x' FROM worlds WHERE slug = 'play' RETURNING id")).rows[0].id;
    expect(await bylineFor(db, plain)).toBeNull();
  });

  it('vanishes on withdrawal or archiving, and with the flag off', async () => {
    const p = await contributor(db, NOW);
    const a = await published(p);
    vi.stubEnv('CONTRIBUTORS_ENABLED', '');
    expect(await bylineFor(db, a.itemId)).toBeNull();
    vi.stubEnv('CONTRIBUTORS_ENABLED', 'true');
    expect(await withdraw(db, p.ctx, a.id, NOW)).toBe('withdrawn');
    expect(await bylineFor(db, a.itemId)).toBeNull();
    const b = await published(p);
    await db.query("UPDATE items SET status = 'archived' WHERE id = $1", [b.itemId]);
    expect(await bylineFor(db, b.itemId)).toBeNull();
  });
});

describe('the contributor page', () => {
  it("lists only that contributor's published items, with the bio; unknown, nothing published or flag off is null", async () => {
    const p = await contributor(db, NOW);
    const q = await contributor(db, NOW);
    const mine = await published(p);
    await published(q);
    await submitted(db, p, NOW);
    const slug = (await getProfile(db, p.id))!.slug;
    const page = await contributorPage(db, slug, scope());
    expect(page!.items.map((i) => i.id)).toEqual([mine.itemId]);
    expect(page!.displayName).toMatch(/^Writer/);
    expect(JSON.stringify(page)).not.toContain(p.email);
    expect(await contributorPage(db, 'zzzzzzzzzz', scope())).toBeNull();
    const idle = await contributor(db, NOW);
    expect(await contributorPage(db, (await getProfile(db, idle.id))!.slug, scope())).toBeNull();
    vi.stubEnv('CONTRIBUTORS_ENABLED', '');
    expect(await contributorPage(db, slug, scope())).toBeNull();
  });

  it('shows a link only once the owner approved it, and never for a 16-17 contributor', async () => {
    const p = await person(db, NOW);
    await enableContributor(db, p.ctx, { displayName: 'Linked Writer', terms: 'on', link: 'https://example.org/me' }, NOW);
    await published(p);
    const slug = (await getProfile(db, p.id))!.slug;
    expect((await contributorPage(db, slug, scope()))!.link).toBeNull();
    await db.query('UPDATE contributor_profiles SET link_approved = true WHERE account_id = $1', [p.id]);
    expect((await contributorPage(db, slug, scope()))!.link).toBe('https://example.org/me');
    await db.query("UPDATE accounts SET date_of_birth = '2009-06-01' WHERE id = $1", [p.id]);
    expect((await contributorPage(db, slug, scope()))!.link).toBeNull();
  });

  it('the sitemap lists contributors with a published item only, and none with the flag off', async () => {
    const p = await contributor(db, NOW);
    await published(p);
    const idle = await contributor(db, NOW);
    const slugs = await contributorSlugs(db, NOW);
    expect(slugs).toContain((await getProfile(db, p.id))!.slug);
    expect(slugs).not.toContain((await getProfile(db, idle.id))!.slug);
    vi.stubEnv('CONTRIBUTORS_ENABLED', '');
    expect(await contributorSlugs(db, NOW)).toEqual([]);
  });
});

describe('JSON-LD', () => {
  const item = { world: 'discover', slug: 'x', title: 'T', summary: 'S', publishedAt: NOW } as PublicItem;
  it('adds author only for a contributed item and is unchanged otherwise', () => {
    const base = articleLd(item, 'https://sparkkindly.com');
    expect(base).not.toHaveProperty('author');
    expect(Object.keys(base)).toEqual(['@context', '@type', 'headline', 'description', 'datePublished', 'mainEntityOfPage', 'image', 'publisher']);
    const ld = articleLd(item, 'https://sparkkindly.com', { name: 'Ada', slug: 'abcdefghij' }) as Record<string, unknown>;
    expect(ld.author).toEqual({ '@type': 'Person', name: 'Ada', url: 'https://sparkkindly.com/contributors/abcdefghij/' });
  });
});
