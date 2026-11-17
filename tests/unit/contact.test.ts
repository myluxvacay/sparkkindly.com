// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { submitContactMessage, createContactLimits } from '@/lib/contact/submit';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const ok = { name: 'Jo Reader', email: 'jo@example.com', topic: 'general', message: 'How do I suggest a story?', website: '' };
const count = async () => Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM contact_messages')).rows[0].n);

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('submitContactMessage', () => {
  it('stores a message with exactly the contact fields, trimmed', async () => {
    const r = await submitContactMessage(db, { ...ok, name: '  Jo Reader  ', message: '  How do I suggest a story?  ' });
    expect(r.status).toBe('stored');
    const rows = await db.query<Record<string, unknown>>('SELECT * FROM contact_messages');
    expect(rows.rows).toHaveLength(1);
    expect(Object.keys(rows.rows[0]).sort()).toEqual(['created_at', 'email', 'id', 'message', 'name', 'status', 'topic']);
    expect(rows.rows[0]).toMatchObject({ name: 'Jo Reader', email: 'jo@example.com', topic: 'general', message: 'How do I suggest a story?', status: 'open' });
  });

  it('accepts a missing or blank name and stores it empty', async () => {
    expect((await submitContactMessage(db, { ...ok, name: undefined })).status).toBe('stored');
    expect((await submitContactMessage(db, { ...ok, name: '   ' })).status).toBe('stored');
    const rows = await db.query<{ name: string }>("SELECT name FROM contact_messages WHERE name = ''");
    expect(rows.rows).toHaveLength(2);
  });

  it('accepts every offered topic and the boundary lengths', async () => {
    for (const topic of ['general', 'suggest', 'error', 'sponsorship', 'other']) {
      expect((await submitContactMessage(db, { ...ok, topic })).status).toBe('stored');
    }
    expect((await submitContactMessage(db, { ...ok, name: 'n'.repeat(100), message: 'm'.repeat(2000) })).status).toBe('stored');
  });

  it('rejects bad input and writes nothing', async () => {
    const before = await count();
    const bad: unknown[] = [
      { ...ok, email: '' },
      { ...ok, email: undefined },
      { ...ok, email: 'not-an-email' },
      { ...ok, email: 'a@b' },
      { ...ok, email: `${'a'.repeat(243)}@example.com` }, // 255 characters
      { ...ok, email: 42 },
      { ...ok, topic: 'spam' },
      { ...ok, topic: undefined },
      { ...ok, message: '' },
      { ...ok, message: '   ' },
      { ...ok, message: undefined },
      { ...ok, message: 42 },
      { ...ok, message: 'm'.repeat(2001) },
      { ...ok, name: 'n'.repeat(101) },
      { ...ok, name: 42 },
    ];
    for (const input of bad) {
      expect(await submitContactMessage(db, input as typeof ok)).toEqual({ status: 'invalid' });
    }
    expect(await count()).toBe(before);
  });

  it('rejects markup in the name, the email or the message, and newlines in the name', async () => {
    const before = await count();
    expect(await submitContactMessage(db, { ...ok, message: '<b>hello</b>' })).toEqual({ status: 'invalid' });
    expect(await submitContactMessage(db, { ...ok, message: 'a < b' })).toEqual({ status: 'invalid' });
    expect(await submitContactMessage(db, { ...ok, name: '<script>' })).toEqual({ status: 'invalid' });
    expect(await submitContactMessage(db, { ...ok, email: '<b>@example.com' })).toEqual({ status: 'invalid' });
    expect(await submitContactMessage(db, { ...ok, name: 'Jo\nBcc: x@y.z' })).toEqual({ status: 'invalid' });
    expect(await count()).toBe(before);
  });

  it('drops a filled honeypot: reported dropped, nothing written', async () => {
    const before = await count();
    expect(await submitContactMessage(db, { ...ok, website: 'http://spam.example' })).toEqual({ status: 'dropped' });
    expect(await count()).toBe(before);
  });
});

describe('contact rate limits', () => {
  it('refuses the sixth message from one client in an hour; another client still succeeds', () => {
    let t = 0;
    const check = createContactLimits(() => t);
    for (let i = 0; i < 5; i++) expect(check('1.1.1.1').ok).toBe(true);
    const sixth = check('1.1.1.1');
    expect(sixth.ok).toBe(false);
    expect(sixth.ok === false && sixth.retryAfter).toBeGreaterThan(0);
    expect(check('2.2.2.2').ok).toBe(true);
    t += 61 * 60_000;
    expect(check('1.1.1.1').ok).toBe(true);
  });

  it('applies a global limit of 200 an hour across clients', () => {
    const check = createContactLimits(() => 0);
    for (let i = 0; i < 200; i++) expect(check(`c${i}`).ok).toBe(true);
    expect(check('fresh').ok).toBe(false);
  });
});
