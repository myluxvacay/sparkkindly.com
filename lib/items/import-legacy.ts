import type { Db, Queryable } from '@/lib/db';
import type { Article, Quiz } from '@/lib/schemas';

type Audience = 'kids' | 'all';
type RiskTier = 'kids' | 'sourced' | 'computable' | 'reflective';

const audienceFor = (world: string): Audience => (world === 'kids' ? 'kids' : 'all');

// By world, so the tier reflects what kind of claims the world makes rather than whether this one item happened to
// carry sources. The legacy items were approved by the owner; a re-submission through the API would face the gates.
function tierFor(world: string, kind: 'article' | 'quiz'): RiskTier {
  if (world === 'kids') return 'kids';
  if (world === 'discover') return 'sourced';
  if (world === 'play' && kind === 'quiz') return 'computable';
  return 'reflective';
}

function imageFor(hero: Article['hero']) {
  const stock = /unsplash/i.test(hero.credit);
  return {
    src: hero.src,
    alt: hero.alt,
    width: hero.width,
    height: hero.height,
    origin: stock ? 'stock' : 'owner-supplied',
    licence: stock ? 'https://unsplash.com/license' : hero.rights,
    credit: hero.credit,
    rights: hero.rights,
  };
}

const at = (date: string | null) => (date ? `${date}T00:00:00Z` : null);

function quizTitle(id: string): string {
  const words = id.replace(/-\d+$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function insertItem(tx: Queryable, row: {
  world: string; kind: 'article' | 'quiz'; slug: string; title: string; summary: string;
  body: unknown; audience: Audience; tier: RiskTier; approved: boolean; reviewer: string | null;
  reviewedAt: string | null; publishAt: string | null; sources: unknown; report: unknown; image: unknown; tags: string[];
}): Promise<string | null> {
  const status = row.approved ? 'published' : 'draft';
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, publish_at, published_at,
                        created_by, risk_tier, sources, quality_report, image, approved_by, approved_at)
     VALUES ((SELECT id FROM worlds WHERE slug = $1), $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $9,
             'legacy-import', $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15)
     ON CONFLICT (world_id, locale, slug) DO NOTHING
     RETURNING id`,
    [row.world, row.kind, row.slug, row.title, row.summary, JSON.stringify(row.body), row.audience, status,
      row.approved ? row.publishAt : null, row.tier, JSON.stringify(row.sources), JSON.stringify(row.report),
      JSON.stringify(row.image), row.approved ? row.reviewer : null, row.approved ? row.reviewedAt : null],
  );
  const id = inserted.rows[0]?.id;
  if (!id) return null;
  if (row.tags.length) {
    await tx.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = ANY($2) ON CONFLICT DO NOTHING', [id, row.tags]);
  }
  await tx.query(
    "INSERT INTO item_revisions (item_id, revision, snapshot, changed_by, reason) VALUES ($1, 1, $2::jsonb, 'legacy-import', 'starter content import')",
    [id, JSON.stringify({ title: row.title, summary: row.summary, body: row.body, status, audience: row.audience })],
  );
  return id;
}

// Imports the mock-up's articles and quizzes. Idempotent: an item that already exists (same world and slug) is left
// untouched, and the counts returned are what this run added. Quiz bodies never include the correct answer; it goes
// to item_answers with the explanation.
export async function importLegacy(db: Db, articles: Article[], quizzes: Quiz[]): Promise<{ items: number; answers: number }> {
  return db.transaction(async (tx) => {
    let items = 0;
    let answers = 0;
    for (const a of articles) {
      const body = {
        sections: a.body,
        takeaway: a.takeaway,
        fiction: a.fiction,
        byline: a.author,
        aiDisclosure: a.aiDisclosure,
        legacyContentType: a.contentType,
        ageGuidance: a.ageGuidance,
        materials: a.materials,
        supervision: a.supervision,
        safetyNotes: a.safetyNotes,
        screenFreeExtension: a.screenFreeExtension,
        correctionNote: a.correctionNote,
        productionStatus: a.productionStatus,
        durationSeconds: a.durationSeconds,
        poster: a.poster,
        videoSrc: a.videoSrc,
        captionsSrc: a.captionsSrc,
        transcript: a.transcript,
      };
      const id = await insertItem(tx, {
        world: a.brand, kind: 'article', slug: a.slug, title: a.title, summary: a.description, body,
        audience: audienceFor(a.brand), tier: tierFor(a.brand, 'article'), approved: a.reviewStatus === 'approved',
        reviewer: a.reviewer, reviewedAt: at(a.reviewedAt), publishAt: at(a.publishedAt), sources: a.sources,
        report: { legacy: true, importedFrom: 'content/articles', reviewNote: a.reviewNote, factualClaimsReviewedAt: a.factualClaimsReviewedAt },
        image: imageFor(a.hero), tags: a.tags,
      });
      if (id) items++;
    }
    for (const q of quizzes) {
      const body = {
        mechanic: 'multiple_choice',
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        difficulty: q.difficulty,
        scheduledDate: q.scheduledDate,
      };
      const id = await insertItem(tx, {
        world: q.brand, kind: 'quiz', slug: q.id, title: quizTitle(q.id), summary: q.prompt, body,
        audience: audienceFor(q.brand), tier: tierFor(q.brand, 'quiz'), approved: q.reviewStatus === 'approved',
        reviewer: q.reviewer, reviewedAt: at(q.reviewedAt), publishAt: at(q.scheduledDate), sources: q.sources,
        report: { legacy: true, importedFrom: 'content/quizzes', reviewNote: q.reviewNote },
        image: { origin: 'template' }, tags: [],
      });
      if (id) {
        items++;
        await tx.query('INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, $3)', [
          id, JSON.stringify(q.correctOptionId), q.explanation,
        ]);
        answers++;
      }
    }
    return { items, answers };
  });
}
