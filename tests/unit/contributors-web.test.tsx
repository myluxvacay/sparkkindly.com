// @vitest-environment node
// The contributor editor's POSTs and page loader (plan 8 Task 4): flags, Origin, adult context only, forged ids and
// fields ignored, another member's contribution not found, and labelled forms that need no JavaScript.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { person } from '../helpers/comments';
import { contributor, drafted, stateOf } from '../helpers/contributors';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile, getContext, type AdultContext } from '@/lib/accounts/context';
import {
  enableRequest,
  loadContributePage,
  saveRequest,
  submitRequest,
  withdrawRequest,
  CONTRIBUTE_MESSAGES,
} from '@/lib/contributors/web';
import { listMine } from '@/lib/contributors/drafts';
import Editor from '@/components/contributors/Editor';
import ProfileForm from '@/components/contributors/ProfileForm';
import SubmitForm from '@/components/contributors/SubmitForm';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const ORIGIN = { host: 'sparkkindly.com', origin: 'https://sparkkindly.com' };

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
afterEach(() => {
  vi.unstubAllEnvs();
});

const d = () => ({ db, now: NOW });
function post(path: string, session: string | null, fields: Record<string, string>, headers: Record<string, string> = ORIGIN) {
  const h: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', ...headers };
  if (session) h.cookie = `__Host-sk_account=${session}`;
  return new Request(`http://localhost${path}`, { method: 'POST', headers: h, body: new URLSearchParams(fields).toString() });
}
const article = {
  kind: 'article',
  world: 'discover',
  title: 'Why the sky looks blue on clear days',
  summary: 'A short look at how sunlight scatters in the air above us.',
  section_heading_0: 'Sunlight',
  section_text_0: 'Sunlight holds every colour.',
  section_heading_1: 'Air',
  section_text_1: 'Small molecules scatter short waves.',
  takeaway: 'Look up.',
  source_title_0: 'NASA',
  source_url_0: 'https://science.nasa.gov/sky',
};
const loc = (r: Response) => r.headers.get('location') ?? '';

describe('flags, Origin and context', () => {
  it('flags off: every POST is 404', async () => {
    const p = await contributor(db, NOW);
    vi.stubEnv('CONTRIBUTORS_ENABLED', '');
    for (const [fn, path] of [[enableRequest, 'enable'], [saveRequest, 'save'], [submitRequest, 'submit'], [withdrawRequest, 'withdraw/confirm']] as const) {
      expect((await fn(post(`/me/contribute/${path}/`, p.session, {}), d())).status, path).toBe(404);
    }
  });

  it('a foreign or missing Origin is 403; no session goes to sign-in', async () => {
    const p = await contributor(db, NOW);
    expect((await saveRequest(post('/me/contribute/save/', p.session, article, { host: 'sparkkindly.com', origin: 'https://evil.example' }), d())).status).toBe(403);
    expect((await saveRequest(post('/me/contribute/save/', p.session, article, { host: 'sparkkindly.com' }), d())).status).toBe(403);
    const r = await saveRequest(post('/me/contribute/save/', null, article), d());
    expect(loc(r)).toBe('/account/sign-in/');
  });

  it('a child context gets 403 on every POST', async () => {
    const p = await contributor(db, NOW);
    const kid = await createChildProfile(db, p.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile');
    expect(await switchToProfile(db, p.session, kid.profileId, NOW)).toBe(true);
    for (const fn of [enableRequest, saveRequest, submitRequest, withdrawRequest]) {
      expect((await fn(post('/me/contribute/x/', p.session, article), d())).status).toBe(403);
    }
  });
});

describe('the POSTs', () => {
  it('enable switches the role on and redirects with an outcome code only', async () => {
    const p = await person(db, NOW);
    const r = await enableRequest(post('/me/contribute/enable/', p.session, { display_name: 'Ada', terms: 'on' }), d());
    expect(loc(r)).toBe('/me/contribute/?r=enabled#result');
    const bad = await enableRequest(post('/me/contribute/enable/', p.session, { display_name: 'admin' }), d());
    expect(loc(bad)).toBe('/me/contribute/?r=name#result');
  });

  it('save stores the draft for the session account whatever account id the form names', async () => {
    const a = await contributor(db, NOW);
    const b = await contributor(db, NOW);
    const r = await saveRequest(post('/me/contribute/save/', a.session, { ...article, account_id: b.id, status: 'published', audience: 'kids' }), d());
    expect(loc(r)).toMatch(/^\/me\/contribute\/\?id=[0-9a-f-]{36}&r=saved#result$/);
    const mine = await listMine(db, a.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].state).toBe('draft');
    expect(await listMine(db, b.id)).toHaveLength(0);
  });

  it("another member's contribution id is not found on save, submit and withdraw", async () => {
    const a = await contributor(db, NOW);
    const b = await contributor(db, NOW);
    const id = await drafted(db, a, NOW);
    expect(loc(await saveRequest(post('/me/contribute/save/', b.session, { ...article, id }), d()))).toBe('/me/contribute/?r=not_found#result');
    expect(loc(await submitRequest(post('/me/contribute/submit/', b.session, { id, original: 'on', licence: 'on' }), d()))).toBe('/me/contribute/?r=not_found#result');
    expect(loc(await withdrawRequest(post('/me/contribute/withdraw/confirm/', b.session, { id }), d()))).toBe('/me/contribute/?r=not_found#result');
    expect((await stateOf(db, id)).state).toBe('draft');
  });

  it('withdraw works for the owner of the contribution', async () => {
    const a = await contributor(db, NOW);
    const id = await drafted(db, a, NOW);
    expect(loc(await withdrawRequest(post('/me/contribute/withdraw/confirm/', a.session, { id }), d()))).toBe('/me/contribute/?r=withdrawn#result');
    expect((await stateOf(db, id)).state).toBe('withdrawn');
  });

  it('every redirect code has a message', () => {
    for (const code of ['enabled', 'saved', 'agent_review', 'gates_failed', 'withdrawn', 'not_found', 'rate', 'pending_limit', 'kids', 'declarations', 'item_locked', 'invalid']) {
      expect(CONTRIBUTE_MESSAGES[code], code).toBeDefined();
    }
  });
});

describe('the page loader', () => {
  it("another member's draft is not found; a 13-15 account gets no page", async () => {
    const a = await contributor(db, NOW);
    const b = await contributor(db, NOW);
    const id = await drafted(db, a, NOW);
    const ctxB = (await getContext(db, b.session, NOW)) as AdultContext;
    expect(await loadContributePage(db, ctxB, { id })).toBe('not_found');
    const ctxA = (await getContext(db, a.session, NOW)) as AdultContext;
    const page = await loadContributePage(db, ctxA, { id });
    expect(page !== 'not_found' && page.editing?.id).toBe(id);
    const teen = await person(db, NOW, '2012-06-01', `p${Math.random()}@example.test`);
    expect(await loadContributePage(db, teen.ctx as AdultContext, {})).toBe('not_found');
  });

  it('offers every enabled world except Kids', async () => {
    const a = await contributor(db, NOW);
    const page = await loadContributePage(db, a.ctx as AdultContext, { new: 'article' });
    if (page === 'not_found') throw new Error('page');
    expect(page.worlds.map((w) => w.slug)).not.toContain('kids');
    expect(page.worlds.length).toBeGreaterThan(0);
  });
});

describe('forms', () => {
  // Every visible input, select and textarea has a label pointing at it, and every form posts without JavaScript.
  function labelled(html: string) {
    expect(html).not.toMatch(/<script/);
    const ids = [...html.matchAll(/<(?:input|select|textarea)(?![^>]*type="hidden")[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    const fields = [...html.matchAll(/<(?:input|select|textarea)(?![^>]*type="hidden")[^>]*>/g)];
    expect(ids.length).toBe(fields.length);
    for (const id of ids) expect(html, id).toContain(`for="${id}"`);
    for (const f of html.matchAll(/<form[^>]*>/g)) expect(f[0]).toMatch(/method="post"/);
  }

  it('profile, editor (article and quiz) and submit forms are labelled and plain HTML', () => {
    labelled(renderToStaticMarkup(<ProfileForm profile={null} adult />));
    const worlds = [{ slug: 'discover', name: 'Discover' }];
    labelled(renderToStaticMarkup(<Editor kind="article" worlds={worlds} topics={[{ slug: 'space', name: 'Space' }]} editing={null} />));
    labelled(renderToStaticMarkup(<Editor kind="quiz" worlds={worlds} editing={null} />));
    labelled(renderToStaticMarkup(<SubmitForm id="11111111-1111-4111-8111-111111111111" />));
  });
});
