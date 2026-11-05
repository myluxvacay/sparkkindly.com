// The owner's immediate alert for an urgent comment report (plan 7B, spec 4a.6): the same recipients and mail path as
// the daily digest (ADMIN_EMAILS, sendEmail). Counts and the admin link only: never comment text, a note, a name or an
// address. No Next.js imports. Verified by tests/unit/comments-reports.test.ts.
import { allowList, linkBase } from '@/lib/admin/sessions';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import type { NotifyOwner } from './reports';

export const ownerAlert =
  (env: EnvLike, send: (m: EmailMessage) => Promise<unknown>): NotifyOwner =>
  async ({ urgent24h }) => {
    const text = [
      'An urgent report has hidden a comment on SparkKindly. It stays hidden until it is ruled on (target: within 24 hours).',
      '',
      `Urgent reports in the last 24 hours: ${urgent24h}`,
      '',
      `Open the comment queue: ${linkBase(env)}/admin/comments/`,
      '',
    ].join('\n');
    for (const to of allowList(env)) await send({ to, subject: 'SparkKindly: an urgent comment report', text });
  };
