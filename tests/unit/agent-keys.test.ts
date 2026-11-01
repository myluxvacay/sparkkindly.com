// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { generateKey, hashSecret, parseKey } from '@/lib/agents/keys';
import { authenticate } from '@/lib/agents/auth';
import { createAgent, UnknownWorldError } from '@/lib/agents/admin';

describe('keys', () => {
  it('generateKey produces the documented format', () => {
    const { key, prefix, hash } = generateKey();
    expect(key).toMatch(/^skagt_[0-9a-f]{8}_[0-9a-f]{48}$/);
    expect(key.startsWith(`skagt_${prefix}_`)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parseKey round-trips and rejects junk', () => {
    const { key, prefix } = generateKey();
    const parsed = parseKey(key)!;
    expect(parsed.prefix).toBe(prefix);
    expect(hashSecret(parsed.secret)).toBe(generateKeyHash(key));
    for (const junk of ['', 'skagt_', 'skagt_zzzzzzzz_' + 'a'.repeat(48), `skagt_${prefix}_short`, `Bearer ${key}`, `${key}x`, 'plain']) {
      expect(parseKey(junk), junk).toBeNull();
    }
  });

  it('what is stored cannot be turned back into the key', () => {
    const { key, hash } = generateKey();
    const secret = parseKey(key)!.secret;
    expect(hash).not.toContain(secret);
    expect(hash).toBe(hashSecret(secret));
    expect(hash).not.toBe(secret);
  });

  it('two keys never collide in practice', () => {
    expect(new Set(Array.from({ length: 50 }, () => generateKey().key)).size).toBe(50);
  });
});

const generateKeyHash = (key: string) => hashSecret(parseKey(key)!.secret);

describe('createAgent and authenticate', () => {
  type TestDb = Awaited<ReturnType<typeof newTestDb>>;
  let db: TestDb;
  beforeAll(async () => {
    db = await newTestDb();
    await seedReference(db);
  });
  afterAll(async () => {
    await db.close();
  });

  it('creates a world agent whose key authenticates and carries its world', async () => {
    const { key } = await createAgent(db, 'play-agent', 'play');
    const agent = await authenticate(db, key);
    expect(agent).toMatchObject({ name: 'play-agent', worldSlug: 'play' });
  });

  it('creates a master agent with no world', async () => {
    const { key } = await createAgent(db, 'master', null);
    expect(await authenticate(db, key)).toMatchObject({ name: 'master', worldId: null, worldSlug: null });
  });

  it('stores only the prefix and a hash, never the key', async () => {
    const { key } = await createAgent(db, 'store-check', 'grow');
    const row = (await db.query<{ key_prefix: string; key_hash: string }>("SELECT key_prefix, key_hash FROM agents WHERE name = 'store-check'")).rows[0];
    expect(JSON.stringify(row)).not.toContain(parseKey(key)!.secret);
  });

  it('rejects an unknown world and a duplicate name', async () => {
    await expect(createAgent(db, 'x', 'nope')).rejects.toBeInstanceOf(UnknownWorldError);
    await createAgent(db, 'dup', 'play');
    await expect(createAgent(db, 'dup', 'play')).rejects.toThrow(/exists|unique|duplicate/i);
  });

  it('rejects a missing, malformed or wrong key', async () => {
    const { key } = await createAgent(db, 'wrongkey', 'play');
    const { prefix } = parseKey(key)!;
    expect(await authenticate(db, null)).toBeNull();
    expect(await authenticate(db, 'junk')).toBeNull();
    expect(await authenticate(db, `skagt_${prefix}_${'0'.repeat(48)}`)).toBeNull(); // right prefix, wrong secret
    expect(await authenticate(db, generateKey().key)).toBeNull(); // unknown prefix
  });

  it('rejects a disabled agent', async () => {
    const { key } = await createAgent(db, 'disabled-one', 'play');
    await db.query("UPDATE agents SET enabled = false WHERE name = 'disabled-one'");
    expect(await authenticate(db, key)).toBeNull();
  });

  it('records last_run_at at most once a minute', async () => {
    const { key } = await createAgent(db, 'lastrun', 'play');
    const t0 = new Date('2026-10-31T10:00:00Z');
    await authenticate(db, key, t0);
    const first = (await db.query<{ last_run_at: Date }>("SELECT last_run_at FROM agents WHERE name = 'lastrun'")).rows[0].last_run_at;
    await authenticate(db, key, new Date(t0.getTime() + 30_000));
    const second = (await db.query<{ last_run_at: Date }>("SELECT last_run_at FROM agents WHERE name = 'lastrun'")).rows[0].last_run_at;
    expect(second.getTime()).toBe(first.getTime());
    await authenticate(db, key, new Date(t0.getTime() + 61_000));
    const third = (await db.query<{ last_run_at: Date }>("SELECT last_run_at FROM agents WHERE name = 'lastrun'")).rows[0].last_run_at;
    expect(third.getTime()).toBe(t0.getTime() + 61_000);
  });
});
