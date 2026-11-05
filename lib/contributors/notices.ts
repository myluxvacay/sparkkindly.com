// The contributor's emails (plan 8): essential mail to the contributor's own account address only. A request for
// changes carries the reviewer's short reasons or the owner's notes, never a transcript; a rejection its reason; the
// publication email the share link and nothing else. No Next.js imports. Verified by tests/unit/contributors-review-api
// and contributors-owner tests.
import type { EmailMessage } from '@/lib/email';

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

export function publishedEmail(o: { to: string; url: string }): EmailMessage {
  return {
    to: o.to,
    subject: 'Your SparkKindly piece is published',
    text: ['Your piece is now published on SparkKindly. Here is the link to share:', '', o.url, ''].join('\n'),
  };
}
