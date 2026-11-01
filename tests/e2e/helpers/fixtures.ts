// Writes extra items straight into the e2e database so a spec can exercise states the starter content lacks
// (an adults item, a draft, a future-dated item, a video_script, a disabled world). Items are marked created_by 'e2e'
// so resetExtras() removes exactly them.
import pg from 'pg';

const URL = 'postgres://postgres@127.0.0.1:54329/postgres?sslmode=disable';

type Over = {
  world: string;
  slug: string;
  kind?: 'article' | 'quiz' | 'game' | 'video_script';
  title?: string;
  summary?: string;
  body?: unknown;
  audience?: 'kids' | 'all' | 'adults';
  status?: 'draft' | 'in_review' | 'scheduled' | 'published' | 'rejected' | 'archived';
  publishedAt?: string | null; // SQL interval or timestamp expression, e.g. "now() + interval '1 day'"
  topics?: string[];
  answer?: { value: unknown; explanation: string };
};

const articleBody = {
  sections: [
    { heading: 'One', paragraphs: ['First paragraph.'] },
    { heading: 'Two', paragraphs: ['Second paragraph.'] },
  ],
  takeaway: 'A takeaway.',
};

// One connection for the whole worker, opened while the site is idle. The in-process test database resets a new
// connection that arrives while another connection has a query in flight, and then stays broken, so a spec must never
// open a fresh one mid-test.
let shared: pg.Client | undefined;

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  if (!shared) {
    const c = new pg.Client({ connectionString: URL });
    c.on('error', () => (shared = undefined));
    await c.connect();
    shared = c;
  }
  return fn(shared);
}

export const sql = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) =>
  withClient((c) => c.query<T>(text, params));

export async function addItem(o: Over): Promise<string> {
  const kind = o.kind ?? 'article';
  const status = o.status ?? 'published';
  const audience = o.audience ?? 'all';
  return withClient(async (c) => {
    const world = await c.query('SELECT id FROM worlds WHERE slug = $1', [o.world]);
    if (!world.rows[0]) throw new Error(`no world ${o.world}`);
    const publishedAt = o.publishedAt === undefined ? (status === 'published' ? "now() - interval '1 minute'" : 'NULL') : (o.publishedAt ?? 'NULL');
    const r = await c.query(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, publish_at,
                          created_by, risk_tier, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, ${publishedAt}, ${publishedAt}, 'e2e', 'computable', 'e2e')
       RETURNING id`,
      [world.rows[0].id, kind, o.slug, o.title ?? `Fixture ${o.slug}`, o.summary ?? 'A fixture summary long enough.',
        JSON.stringify(o.body ?? (kind === 'article' ? articleBody : {})), audience, status],
    );
    const id = r.rows[0].id as string;
    for (const t of o.topics ?? []) {
      await c.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = $2', [id, t]);
    }
    if (o.answer) {
      await c.query('INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, $3)', [
        id, JSON.stringify(o.answer.value), o.answer.explanation,
      ]);
    }
    return id;
  });
}

export async function setWorldEnabled(slug: string, enabled: boolean): Promise<void> {
  await withClient((c) => c.query('UPDATE worlds SET enabled = $2 WHERE slug = $1', [slug, enabled]));
}

export async function resetExtras(): Promise<void> {
  await withClient(async (c) => {
    await c.query("DELETE FROM items WHERE created_by = 'e2e'");
    await c.query('UPDATE worlds SET enabled = true');
    await c.query("DELETE FROM worlds WHERE goals = 'e2e-fixture'");
    await c.query("DELETE FROM topics WHERE slug LIKE 'e2e-%'");
  });
}

// A world and a topic that only the e2e run creates; resetExtras() removes them (items first, so nothing blocks the delete).
export async function addWorld(slug: string, name: string): Promise<void> {
  await withClient((c) =>
    c.query("INSERT INTO worlds (slug, name, promise, description, icon, color, sort, goals) VALUES ($1, $2, 'A fixture promise.', 'A fixture world.', '*', 'gold', 99, 'e2e-fixture')", [slug, name]),
  );
}

export async function addTopic(slug: string, name: string): Promise<void> {
  await withClient((c) => c.query('INSERT INTO topics (slug, name) VALUES ($1, $2)', [slug, name]));
}
