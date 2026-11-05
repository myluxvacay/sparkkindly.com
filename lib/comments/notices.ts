// The owner's immediate alert for an urgent comment report (plan 7B, spec 4a.6): the same recipients and mail path as
// the daily digest (ADMIN_EMAILS, sendEmail). It says whether the comment was hidden (7B review H1). Counts and the admin link only: never comment text, a note, a name or an
// address. No Next.js imports. Verified by tests/unit/comments-reports.test.ts.
import { allowList, linkBase } from '@/lib/admin/sessions';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import type { NotifyOwner } from './reports';

export const ownerAlert =
  (env: EnvLike, send: (m: EmailMessage) => Promise<unknown>): NotifyOwner =>
  async ({ urgent24h, hidden, capReached }) => {
    const what = capReached
      ? 'Urgent-alert cap reached for today: no more urgent-report emails will be sent until tomorrow (UTC). See the admin queue for every urgent report.'
      : hidden
      ? 'An urgent report has hidden a comment on SparkKindly. It stays hidden until it is ruled on (target: within 24 hours).'
      : "An urgent report was made about a comment on SparkKindly. It was not hidden (the reporter's reports are muted); it waits for you (target: within 24 hours).";
    const text = [
      what,
      '',
      `Urgent reports in the last 24 hours: ${urgent24h}`,
      '',
      `Open the comment queue: ${linkBase(env)}/admin/comments/`,
      '',
    ].join('\n');
    for (const to of allowList(env)) await send({ to, subject: 'SparkKindly: an urgent comment report', text });
  };
