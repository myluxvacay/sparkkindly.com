// Request-a-Creation records: plain SQL over printable_requests / printable_request_votes
// (migration 046). Callers validate shapes (lib/requests/submit.ts validates the public form; the
// admin actions validate theirs). Public reads name their statuses explicitly — pending and declined
// requests are never selected for a public surface. No Next.js imports.
// Verified by tests/unit/requests-repo.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { PrintableRequest, RequestStatus } from './types';

type Row = {
  id: string;
  category_topic: string;
  age_topic: string;
  request_text: string;
  status: RequestStatus;
  created_url: string | null;
  me_too_count: number;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
};

const COLS = 'id, category_topic, age_topic, request_text, status, created_url, me_too_count, created_at, updated_at, reviewed_at';

const toRequest = (r: Row): PrintableRequest => ({
  id: r.id,
  categoryTopic: r.category_topic,
  ageTopic: r.age_topic,
  requestText: r.request_text,
  status: r.status,
  createdUrl: r.created_url,
  meTooCount: r.me_too_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  reviewedAt: r.reviewed_at,
});

export async function createRequest(
  db: Queryable,
  input: { categoryTopic: string; ageTopic: string; requestText: string; submitterHash: string },
): Promise<PrintableRequest> {
  const { rows } = await db.query<Row>(
    `INSERT INTO printable_requests (category_topic, age_topic, request_text, submitter_hash)
     VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
    [input.categoryTopic, input.ageTopic, input.requestText, input.submitterHash],
  );
  return toRequest(rows[0]);
}

export async function getRequest(db: Queryable, id: string): Promise<PrintableRequest | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLS} FROM printable_requests WHERE id = $1`, [id]);
  return rows[0] ? toRequest(rows[0]) : null;
}

// The public Fresh Requests shelf: approved requests still waiting to be made, most-wanted first,
// then the made ones, newest first. Pending and declined are never selected here.
export async function listPublicRequests(db: Queryable, limit = 100): Promise<PrintableRequest[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLS} FROM printable_requests
     WHERE status IN ('approved', 'created')
     ORDER BY (status = 'created'), me_too_count DESC, created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(toRequest);
}

// The admin queue: one status at a time (the page filters), oldest first so nothing waits forever.
export async function listRequestsByStatus(db: Queryable, status: RequestStatus, limit = 200): Promise<PrintableRequest[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLS} FROM printable_requests WHERE status = $1 ORDER BY created_at ASC LIMIT $2`,
    [status, limit],
  );
  return rows.map(toRequest);
}

export async function countRequestsByStatus(db: Queryable): Promise<Record<RequestStatus, number>> {
  const { rows } = await db.query<{ status: RequestStatus; n: string }>(
    'SELECT status, COUNT(*)::text AS n FROM printable_requests GROUP BY status',
  );
  const counts: Record<RequestStatus, number> = { pending: 0, approved: 0, declined: 0, created: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

// One status move, guarded by the statuses it may start from (the admin actions name them). Returns
// false when the row is not in a from-status — a stale page or a double decision, not an error.
export async function setRequestStatus(
  db: Queryable,
  id: string,
  from: RequestStatus[],
  to: RequestStatus,
  createdUrl: string | null,
  now: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE printable_requests
     SET status = $1, created_url = $2, reviewed_at = $3, updated_at = $3
     WHERE id = $4 AND status = ANY($5)`,
    [to, createdUrl, now, id, from],
  );
  return (rowCount ?? 0) > 0;
}

// A me-too vote. The votes table's primary key dedupes per visitor: the count moves only when the
// vote row actually lands, inside the same transaction, so count and votes can never disagree.
// Only shelf-visible requests (approved / created) can collect votes.
export async function addMeToo(db: Db, id: string, voterHash: string): Promise<{ counted: boolean; meTooCount: number }> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO printable_request_votes (request_id, voter_hash)
       SELECT id, $2 FROM printable_requests WHERE id = $1 AND status IN ('approved', 'created')
       ON CONFLICT DO NOTHING`,
      [id, voterHash],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      const current = await getRequest(tx, id);
      return { counted: false, meTooCount: current?.meTooCount ?? 0 };
    }
    const { rows } = await tx.query<{ me_too_count: number }>(
      'UPDATE printable_requests SET me_too_count = me_too_count + 1, updated_at = now() WHERE id = $1 RETURNING me_too_count',
      [id],
    );
    return { counted: true, meTooCount: rows[0].me_too_count };
  });
}
