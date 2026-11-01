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

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

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
  });
}
