// Fixtures shared by the social distribution tests (plan 5A): items written straight into the test database, and
// distribution rows in a chosen state.
import type { Queryable } from '@/lib/db';

let n = 0;

export type SocialItemOpts = {
  world?: string;
  kind?: string;
  audience?: string;
  riskTier?: string;
  status?: string;
  publishedAt?: string;
  topic?: string;
  title?: string;
  summary?: string;
  body?: unknown;
};

export async function socialItem(db: Queryable, o: SocialItemOpts = {}): Promise<string> {
  const audience = o.audience ?? 'all';
  const tier = o.riskTier ?? (audience === 'kids' || o.world === 'kids' ? 'kids' : 'reflective');
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier,
                        approved_by)
     SELECT id, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'test', $10, 'owner' FROM worlds WHERE slug = $1 RETURNING id`,
    [
      o.world ?? 'play',
      o.kind ?? 'article',
      `social-item-${n++}`,
      o.title ?? 'A title',
      o.summary ?? 'A summary',
      JSON.stringify(o.body ?? { paragraphs: ['Body text.'] }),
      audience,
      o.status ?? 'published',
      o.publishedAt ?? '2026-11-04T08:00:00Z',
      tier,
    ],
  );
  const id = r.rows[0].id;
  if (o.topic) {
    await db.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = $2', [id, o.topic]);
  }
  return id;
}

export type DistOpts = { status?: string; day?: string; scheduledFor?: string | null; postedAt?: string | null; caption?: string };

export async function distribution(db: Queryable, itemId: string, platform: string, o: DistOpts = {}): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO distributions (item_id, platform, day, status, scheduled_for, posted_at, caption, hashtags, link, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '["kindness"]'::jsonb, $8, $9) RETURNING id`,
    [
      itemId,
      platform,
      o.day ?? '2026-11-05',
      o.status ?? 'selected',
      o.scheduledFor ?? null,
      o.postedAt ?? null,
      o.caption ?? null,
      o.caption ? 'https://sparkkindly.com/play/x/?utm_source=instagram' : null,
      o.caption ? 'https://sparkkindly.com/api/template-image/play/x/?format=social' : null,
    ],
  );
  return r.rows[0].id;
}

export const statusOf = async (db: Queryable, id: number) =>
  (await db.query<{ status: string }>('SELECT status FROM distributions WHERE id = $1', [id])).rows[0]?.status;
