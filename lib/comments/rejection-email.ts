// The author's emails about a moderation decision (plan 7B). Essential mail, sent whatever the notification settings, to
// the author's own account address only. They carry the author's own excerpt (first 80 characters), the private reason,
// the community guidelines link and the appeal link; never another member's text, name or address, never a note from a
// report. No Next.js imports. Verified by tests/unit/comments-moderation.test.ts and comments-appeals.test.ts.
import type { EmailMessage } from '@/lib/email';

export const EXCERPT = 80;

// What the author is told, from a closed list (7B review M2): the agent picks a code, never the words. Its free-text
// reason (and its escalation note) stay with the owner.
export const AUTHOR_REASONS = {
  abuse: 'It is unkind to another person: a personal attack, insult, mockery or threat.',
  personal_info: 'It shares personal information about someone.',
  advertising: 'It advertises, sells or promotes something.',
  off_topic: 'It is not about the item it was posted on.',
  links: 'It contains a link, and links are not allowed in comments yet.',
  other: 'It does not follow the community guidelines.',
} as const;
export type ReasonCode = keyof typeof AUTHOR_REASONS;
export const REASON_CODES = Object.keys(AUTHOR_REASONS) as [ReasonCode, ...ReasonCode[]];
export const isReasonCode = (v: unknown): v is ReasonCode => typeof v === 'string' && Object.hasOwn(AUTHOR_REASONS, v);
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
