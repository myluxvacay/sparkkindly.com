// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

let n = 0;
const unique = () => `t${++n}`;

async function world(slug = unique()): Promise<number> {
  const r = await db.query<{ id: number }>('INSERT INTO worlds (slug, name) VALUES ($1, $1) RETURNING id', [slug]);
  return r.rows[0].id;
}

async function item(over: Record<string, unknown> = {}): Promise<string> {
  const w = (over.world_id as number | undefined) ?? (await world());
  const row = {
    kind: 'article',
    slug: unique(),
    locale: 'en',
    title: 'A title',
    summary: 'A summary',
    body: {},
    audience: 'all',
    status: 'draft',
    created_by: 'test',
    risk_tier: 'reflective',
    approved_by: null,
    agent_id: null,
    idempotency_key: null,
    ...over,
    world_id: w,
  };
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, locale, title, summary, body, audience, status, created_by, risk_tier, approved_by, agent_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [row.world_id, row.kind, row.slug, row.locale, row.title, row.summary, JSON.stringify(row.body), row.audience,
      row.status, row.created_by, row.risk_tier, row.approved_by, row.agent_id, row.idempotency_key],
  );
  return r.rows[0].id;
}

describe('items constraints', () => {
  it('rejects an unknown status', async () => {
    await expect(item({ status: 'live' })).rejects.toThrow(/check constraint/);
  });

  it('rejects an unknown audience, risk tier and kind', async () => {
    await expect(item({ audience: 'teens' })).rejects.toThrow(/check constraint/);
    await expect(item({ risk_tier: 'safe' })).rejects.toThrow(/check constraint/);
    await expect(item({ kind: 'poll' })).rejects.toThrow(/check constraint/);
  });

  it('(world, locale, slug) is unique', async () => {
    const w = await world();
    await item({ world_id: w, slug: 'same' });
    await expect(item({ world_id: w, slug: 'same' })).rejects.toThrow(/unique|duplicate/);
    await expect(item({ world_id: w, slug: 'same', locale: 'fr' })).resolves.toBeTruthy();
  });

  it('(agent, idempotency key) is unique, and many items may have no key', async () => {
    const w = await world();
    const a = await db.query<{ id: number }>(
      "INSERT INTO agents (name, key_prefix, key_hash) VALUES ($1, $2, 'h') RETURNING id", [unique(), unique()]);
    const agentId = a.rows[0].id;
    await item({ world_id: w, agent_id: agentId, idempotency_key: 'k1' });
    await expect(item({ world_id: w, agent_id: agentId, idempotency_key: 'k1' })).rejects.toThrow(/unique|duplicate/);
    await expect(item({ world_id: w })).resolves.toBeTruthy();
    await expect(item({ world_id: w })).resolves.toBeTruthy();
  });
});

describe('the Kids approval guarantee lives in the database', () => {
  it('a Kids item cannot be scheduled without approved_by', async () => {
    const id = await item({ risk_tier: 'kids', audience: 'kids' });
    await expect(db.query("UPDATE items SET status='scheduled' WHERE id=$1", [id])).rejects.toThrow(/kids_requires_approval/);
    await expect(
      db.query("UPDATE items SET status='scheduled', approved_by='owner' WHERE id=$1", [id]),
    ).resolves.toBeTruthy();
  });

  it('an audience kids item cannot be published without approved_by, whatever its risk tier', async () => {
    const id = await item({ audience: 'kids', risk_tier: 'reflective' });
    await expect(db.query("UPDATE items SET status='published' WHERE id=$1", [id])).rejects.toThrow(/kids_requires_approval/);
  });

  it('a risk-tier kids item cannot be inserted already published without approval', async () => {
    await expect(item({ risk_tier: 'kids', audience: 'all', status: 'published' })).rejects.toThrow(/kids_requires_approval/);
  });

  it('a Kids item may sit in draft and in_review without approval', async () => {
    await expect(item({ risk_tier: 'kids', audience: 'kids', status: 'draft' })).resolves.toBeTruthy();
    await expect(item({ risk_tier: 'kids', audience: 'kids', status: 'in_review' })).resolves.toBeTruthy();
  });

  it('a non-Kids item can be scheduled without approval', async () => {
    await expect(item({ status: 'scheduled' })).resolves.toBeTruthy();
  });
});

describe('review-mode worlds need approval whatever the item says about itself', () => {
  async function reviewWorld(): Promise<number> {
    const r = await db.query<{ id: number }>(
      "INSERT INTO worlds (slug, name, approval_mode) VALUES ($1, $1, 'review') RETURNING id", [unique()]);
    return r.rows[0].id;
  }

  it('an audience-all, reflective item in a review-mode world cannot be scheduled or published without approved_by', async () => {
    const w = await reviewWorld();
    const id = await item({ world_id: w, audience: 'all', risk_tier: 'reflective' });
    await expect(db.query("UPDATE items SET status='scheduled' WHERE id=$1", [id])).rejects.toThrow(/kids_requires_approval/);
    await expect(db.query("UPDATE items SET status='published' WHERE id=$1", [id])).rejects.toThrow(/kids_requires_approval/);
    await expect(db.query("UPDATE items SET status='scheduled', approved_by='owner' WHERE id=$1", [id])).resolves.toBeTruthy();
  });

  it('an item cannot be inserted already scheduled in a review-mode world without approval', async () => {
    const w = await reviewWorld();
    await expect(item({ world_id: w, status: 'scheduled' })).rejects.toThrow(/kids_requires_approval/);
    await expect(item({ world_id: w, status: 'scheduled', approved_by: 'owner' })).resolves.toBeTruthy();
  });

  it('an unapproved scheduled item cannot be moved into a review-mode world', async () => {
    const w = await reviewWorld();
    const id = await item({ status: 'scheduled' });
    await expect(db.query('UPDATE items SET world_id=$2 WHERE id=$1', [id, w])).rejects.toThrow(/kids_requires_approval/);
  });

  it('draft and in_review items in a review-mode world need nothing', async () => {
    const w = await reviewWorld();
    await expect(item({ world_id: w, status: 'draft' })).resolves.toBeTruthy();
    await expect(item({ world_id: w, status: 'in_review' })).resolves.toBeTruthy();
  });

  it('switching a world to review mode does not block archiving what is already published', async () => {
    const w = await world();
    const id = await item({ world_id: w, status: 'published' });
    await db.query("UPDATE worlds SET approval_mode='review' WHERE id=$1", [w]);
    await expect(db.query("UPDATE items SET status='archived' WHERE id=$1", [id])).resolves.toBeTruthy();
  });
});

describe('the Kids world always stays in review mode', () => {
  it('cannot be created or switched to auto', async () => {
    await expect(db.query("INSERT INTO worlds (slug, name, approval_mode) VALUES ('kids', 'Kids', 'auto')")).rejects.toThrow(/kids_world_reviews/);
    await db.query("INSERT INTO worlds (slug, name, approval_mode) VALUES ('kids', 'Kids', 'review') ON CONFLICT (slug) DO NOTHING");
    await expect(db.query("UPDATE worlds SET approval_mode='auto' WHERE slug='kids'")).rejects.toThrow(/kids_world_reviews/);
  });
});

describe('problem reports', () => {
  const report = (id: string, reason = 'wrong', message = 'It is wrong.') =>
    db.query('INSERT INTO problem_reports (item_id, reason, message) VALUES ($1, $2, $3)', [id, reason, message]);

  it('stores a valid report as open', async () => {
    const id = await item();
    await report(id);
    const r = await db.query<{ status: string }>('SELECT status FROM problem_reports WHERE item_id = $1', [id]);
    expect(r.rows).toEqual([{ status: 'open' }]);
  });

  it('rejects an unknown reason and a message over 1000 characters', async () => {
    const id = await item();
    await expect(report(id, 'spam')).rejects.toThrow();
    await expect(report(id, 'wrong', 'x'.repeat(1001))).rejects.toThrow();
    await expect(report(id, 'wrong', 'x'.repeat(1000))).resolves.toBeTruthy();
  });

  it('is removed with its item and records nothing about the reporter', async () => {
    const id = await item();
    await report(id);
    await db.query('DELETE FROM items WHERE id = $1', [id]);
    expect((await db.query('SELECT 1 FROM problem_reports WHERE item_id = $1', [id])).rows).toHaveLength(0);
    const cols = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'problem_reports'");
    expect(cols.rows.map((c) => c.column_name).sort()).toEqual(['created_at', 'id', 'item_id', 'message', 'reason', 'status']);
  });
});

describe('relations', () => {
  it('deleting an item removes its answers, topics and revisions', async () => {
    const id = await item();
    const t = await db.query<{ id: number }>("INSERT INTO topics (slug, name) VALUES ($1, 'T') RETURNING id", [unique()]);
    await db.query('INSERT INTO item_topics (item_id, topic_id) VALUES ($1, $2)', [id, t.rows[0].id]);
    await db.query("INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, '\"a\"'::jsonb, 'because')", [id]);
    await db.query("INSERT INTO item_revisions (item_id, revision, snapshot, changed_by) VALUES ($1, 1, '{}'::jsonb, 'x')", [id]);
    await db.query('DELETE FROM items WHERE id = $1', [id]);
    for (const table of ['item_topics', 'item_answers', 'item_revisions']) {
      const r = await db.query(`SELECT 1 FROM ${table} WHERE item_id = $1`, [id]);
      expect(r.rows).toHaveLength(0);
    }
  });

  it('a sponsorship must target exactly one of world, topic, item', async () => {
    const s = await db.query<{ id: number }>("INSERT INTO sponsors (name, link, disclosure) VALUES ('S','https://s.example','d') RETURNING id");
    const w = await world();
    const sid = s.rows[0].id;
    await expect(db.query("INSERT INTO sponsorships (sponsor_id, label) VALUES ($1, 'none')", [sid])).rejects.toThrow(/check constraint/);
    const i = await item({ world_id: w });
    await expect(
      db.query("INSERT INTO sponsorships (sponsor_id, world_id, item_id, label) VALUES ($1,$2,$3,'two')", [sid, w, i]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query("INSERT INTO sponsorships (sponsor_id, world_id, label) VALUES ($1,$2,'one')", [sid, w]),
    ).resolves.toBeTruthy();
  });

  it('a world defaults to auto approval with a three-day buffer', async () => {
    const w = await world();
    const r = await db.query<{ approval_mode: string; buffer_days: number }>('SELECT approval_mode, buffer_days FROM worlds WHERE id=$1', [w]);
    expect(r.rows[0]).toEqual({ approval_mode: 'auto', buffer_days: 3 });
    await expect(db.query("UPDATE worlds SET approval_mode='manual' WHERE id=$1", [w])).rejects.toThrow(/check constraint/);
  });
});

describe('admin tables (Project 1C)', () => {
  it('stores admin emails in lower case only', async () => {
    await expect(db.query("INSERT INTO admin_users (email, totp_secret) VALUES ('Owner@Example.test', 'v1:X')")).rejects.toThrow();
    await db.query("INSERT INTO admin_users (email, totp_secret) VALUES ('owner@example.test', 'v1:X')");
  });

  it('allows only the code and active session stages', async () => {
    await expect(
      db.query(
        "INSERT INTO admin_sessions (token_hash, email, stage, expires_at, last_seen_at) VALUES ('h1', 'a@example.test', 'root', now(), now())",
      ),
    ).rejects.toThrow();
  });

  it('records a job run once per key', async () => {
    await db.query("INSERT INTO job_runs (job, run_key) VALUES ('digest', '2026-11-01')");
    await expect(db.query("INSERT INTO job_runs (job, run_key) VALUES ('digest', '2026-11-01')")).rejects.toThrow();
  });
});
