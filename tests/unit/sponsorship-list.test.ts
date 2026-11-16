// @vitest-environment node
// The public sponsors list and one-per-category rule (owner request, 15 November 2026): listPublicSponsors
// feeds the Our sponsors section on /sponsorship/. It shows confirmed sponsors to exactly the viewers who
// may see sponsorship, and createSponsor refuses a second sponsor in a category that already has one.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { person } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { createSponsor } from '@/lib/sponsorship/admin';
import { listPublicSponsors } from '@/lib/sponsorship/list';
import type { Db } from '@/lib/db';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-15T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('SPONSORSHIP_ENABLED', 'true');
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
});

const form = (name: string, category: string, link = 'https://sponsor.example/') =>
  new URLSearchParams({ name, link, category, confirmed: 'on' });

describe('one sponsor per category', () => {
  it('accepts the first sponsor in a category and refuses a second in the same one', async () => {
    const first = await createSponsor(db as unknown as Db, form('My Lux Vacation', 'travel', 'https://myluxvacation.com/'), NOW);
    expect(first.ok).toBe(true);
    const second = await createSponsor(db as unknown as Db, form('Other Travel Co', 'travel', 'https://other.example/'), NOW);
    expect(second).toEqual({ ok: false, reason: 'category' });
    const otherCategory = await createSponsor(db as unknown as Db, form('Corner Bakery', 'food'), NOW);
    expect(otherCategory.ok).toBe(true);
  });
});

describe('listPublicSponsors', () => {
  it('lists confirmed sponsors with category labels for an anonymous viewer, and hides unconfirmed ones', async () => {
    await db.query("INSERT INTO sponsors (name, link, category, confirmed_at) VALUES ('Unconfirmed Co', 'https://no.example/', 'books', NULL)");
    const list = await listPublicSponsors(db as unknown as Db, undefined, NOW);
    expect(list).not.toBeNull();
    const names = list!.map((s) => s.name);
    expect(names).toContain('My Lux Vacation');
    expect(names).toContain('Corner Bakery');
    expect(names).not.toContain('Unconfirmed Co');
    expect(list!.find((s) => s.name === 'My Lux Vacation')).toMatchObject({ category: 'travel', categoryLabel: 'Travel' });
  });

  it('is hidden entirely when the flag is off', async () => {
    vi.stubEnv('SPONSORSHIP_ENABLED', '');
    expect(await listPublicSponsors(db as unknown as Db, undefined, NOW)).toBeNull();
  });

  it('is hidden from a signed-in under-18 viewer and visible to an adult member', async () => {
    const teen = await person(db as unknown as Db, NOW, '2010-01-01');
    expect(await listPublicSponsors(db as unknown as Db, teen.session, NOW)).toBeNull();
    const adult = await person(db as unknown as Db, NOW);
    const list = await listPublicSponsors(db as unknown as Db, adult.session, NOW);
    expect(list!.map((s) => s.name)).toContain('My Lux Vacation');
  });
});
