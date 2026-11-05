// The contributor's emails (plan 8): essential mail to the contributor's own account address only. A request for
// changes carries the reviewer's short reasons or the owner's notes, never a transcript; a rejection its reason; the
// publication email the share link and nothing else. No Next.js imports. Verified by tests/unit/contributors-review-api
// and contributors-owner tests.
import { linkBase } from '@/lib/admin/sessions';
import type { Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';

const list = (lines: string[]) => lines.map((l) => `- ${l}`).join('\n');

export function changesEmail(o: { to: string; title: string; notes: string[]; site: string }): EmailMessage {
  return {
    to: o.to,
    subject: 'Your SparkKindly contribution needs changes',
    text: [
      `Thank you for "${o.title}". Before it can go further, please look at these points:`,
      '',
      list(o.notes),
      '',
      `You can revise and resubmit it here: ${o.site}/me/contribute/`,
      '',
    ].join('\n'),
  };
}

export function rejectedEmail(o: { to: string; title: string; reason: string; site: string }): EmailMessage {
  return {
    to: o.to,
    subject: 'Your SparkKindly contribution',
    text: [
      `Thank you for "${o.title}". We are not able to publish it.`,
      '',
      `Reason: ${o.reason}`,
      '',
      `Your contributions: ${o.site}/me/contribute/`,
      '',
    ].join('\n'),
  };
}

const NOTICE_BATCH = 50;
type Notice = { id: string; email: string; world: string; slug: string };

// The worker's contribution mail (after publish-due): one publication email per approved contributed item that is now
// published. Each is claimed (publication_mailed_at, set only where still NULL) before it is sent, so a rerun or a second
// worker never mails twice. Ruling: a failed send is not retried (the claim stays), as for circle mail.
export async function sendPublicationNotices(
  db: Queryable,
  now: Date,
  env: EnvLike,
  send: (m: EmailMessage) => Promise<unknown>,
): Promise<{ sent: number; failed: number }> {
  const r = await db.query<Notice>(
    `SELECT c.id, a.email, w.slug AS world, i.slug FROM contributions c JOIN items i ON i.id = c.item_id
     JOIN worlds w ON w.id = i.world_id JOIN accounts a ON a.id = c.account_id
     WHERE c.state = 'approved' AND i.status = 'published' AND c.publication_mailed_at IS NULL
     ORDER BY i.published_at, c.id LIMIT $1`,
    [NOTICE_BATCH],
  );
  const out = { sent: 0, failed: 0 };
  for (const n of r.rows) {
    const claim = await db.query('UPDATE contributions SET publication_mailed_at = $2 WHERE id = $1 AND publication_mailed_at IS NULL RETURNING id', [
      n.id, now.toISOString(),
    ]);
    if (!claim.rows.length) continue;
    try {
      await send(publishedEmail({ to: n.email, url: `${linkBase(env)}/${n.world}/${n.slug}/` }));
      out.sent++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

export function publishedEmail(o: { to: string; url: string }): EmailMessage {
  return {
    to: o.to,
    subject: 'Your SparkKindly piece is published',
    text: ['Your piece is now published on SparkKindly. Here is the link to share:', '', o.url, ''].join('\n'),
  };
}
