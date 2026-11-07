// @vitest-environment node
// Final review M2: the ?format=social branch of /api/template-image/<world>/<slug>/ respects the viewer's scope. A
// request without an account cookie (Meta's fetcher) gets the public card; a child-profile session never gets an
// `adults` item's card (a failed session lookup fails closed to the child audiences in viewerForSession, covered by
// tests/unit/account-scope.test.ts). A response that depended on
// a cookie is private, no-store, and every response varies on Cookie.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { newTestDb } from '../helpers/test-db';
import { socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import type { Scope } from '@/lib/public/scope';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const session: { token: string | undefined; audiences: Scope['audiences'] } = { token: undefined, audiences: [] };

vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), getDb: () => db }));
vi.mock('@/lib/accounts/scope-next', async (orig) => ({
  ...(await orig<object>()),
  accountSessionToken: async () => session.token,
  currentScope: async () => ({ audiences: session.audiences, now: new Date() }),
}));

const { GET } = await import('@/app/api/template-image/[world]/[slug]/route');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  session.token = undefined;
  session.audiences = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const slugOf = async (id: string) => (await db.query<{ slug: string }>('SELECT slug FROM items WHERE id = $1', [id])).rows[0].slug;
const get = (slug: string) =>
  GET(new Request(`http://localhost/api/template-image/play/${slug}/?format=social`), {
    params: Promise.resolve({ world: 'play', slug }),
  });
const asChild = () => {
  session.token = 'c'.repeat(64);
  session.audiences = ['kids', 'all'];
};

describe('the social share card and the viewer scope', () => {
  it('anonymous: an adults item is a public JPEG that varies on Cookie', async () => {
    const res = await get(await slugOf(await socialItem(db, { audience: 'adults', title: 'Grown-up card' })));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/^public/);
    expect(res.headers.get('vary')).toMatch(/Cookie/);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format).toBe('jpeg');
  });

  it('child-profile session: an adults item is 404', async () => {
    const slug = await slugOf(await socialItem(db, { audience: 'adults', title: 'Not for children' }));
    asChild();
    const res = await get(slug);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toMatch(/Cookie/);
  });

  it('child-profile session: an `all` item is a 200 JPEG, private because it depended on the cookie', async () => {
    const slug = await slugOf(await socialItem(db, { audience: 'all', title: 'For everyone' }));
    asChild();
    const res = await get(slug);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toMatch(/Cookie/);
  });

  it('eligibility and the flag are unchanged: Kids and draft are 404, SOCIAL_ENABLED off is not the social card', async () => {
    expect((await get(await slugOf(await socialItem(db, { audience: 'kids' })))).status).toBe(404);
    expect((await get(await slugOf(await socialItem(db, { status: 'draft' })))).status).toBe(404);
    const slug = await slugOf(await socialItem(db, { audience: 'all', title: 'Flag off' }));
    vi.stubEnv('SOCIAL_ENABLED', '');
    const res = await get(slug);
    expect(res.headers.get('content-type')).not.toBe('image/jpeg');
  });
});
