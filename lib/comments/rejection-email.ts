// The author's emails about a moderation decision (plan 7B). Essential mail, sent whatever the notification settings, to
// the author's own account address only. They carry the author's own excerpt (first 80 characters), the private reason,
// the community guidelines link and the appeal link; never another member's text, name or address, never a note from a
// report. No Next.js imports. Verified by tests/unit/comments-moderation.test.ts and comments-appeals.test.ts.
import type { EmailMessage } from '@/lib/email';

export const EXCERPT = 80;
const excerpt = (body: string) => [...body].slice(0, EXCERPT).join('');

export function rejectionEmail(o: { to: string; body: string; reason: string; site: string; appealUrl: string | null }): EmailMessage {
  const appeal = o.appealUrl
    ? `If you think this was a mistake, you can appeal within 30 days. The site owner will look at it:\n${o.appealUrl}`
    : 'Appeals cannot be filed online at the moment.';
  return {
    to: o.to,
    subject: 'Your SparkKindly comment was removed',
    text: [
      'A comment you posted on SparkKindly is not shown:',
      '',
      `"${excerpt(o.body)}"`,
      '',
      `Reason: ${o.reason}`,
      '',
      `Our community guidelines: ${o.site}/community/guidelines/`,
      '',
      appeal,
      '',
    ].join('\n'),
  };
}

export function appealOutcomeEmail(o: { to: string; body: string; outcome: 'overturn' | 'uphold'; site: string }): EmailMessage {
  const result =
    o.outcome === 'overturn'
      ? 'The site owner has looked at your appeal and agrees with you: your comment is published again.'
      : 'The site owner has looked at your appeal and the decision stands: your comment stays removed.';
  return {
    to: o.to,
    subject: 'Your SparkKindly appeal',
    text: [`About your comment "${excerpt(o.body)}":`, '', result, '', `Our community guidelines: ${o.site}/community/guidelines/`, ''].join('\n'),
  };
}
