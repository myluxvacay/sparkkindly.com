// The parent's consent email (first request and the 7-day reminder), plain text. One function so the sign-up flow and the
// sweep say exactly the same things. No Next.js imports; verified by tests/unit/account-consent-sweep.test.ts.
export type ConsentEmailLinks = { confirmUrl: string; withdrawUrl: string; privacyUrl: string; deletionDate?: Date };

export const CONSENT_HOLDS = [
  'their email address',
  'your email address, kept only as the record of your consent and so you can withdraw it',
  'their date of birth',
  'the interests they choose',
  'their quiz answers and scores',
  'the friend circles they join or create (once you confirm) and their scores within them',
] as const;

export function consentEmail(kind: 'request' | 'reminder', links: ConsentEmailLinks): { subject: string; text: string } {
  const reminder = kind === 'reminder';
  return {
    subject: reminder
      ? 'Reminder: your child is waiting for your OK on SparkKindly'
      : 'Your child asked to join SparkKindly: please confirm',
    text: [
      reminder
        ? 'This is a reminder. A young person aged 13 to 15 signed up for a SparkKindly account with your email address as their parent or guardian, and we have not heard from you yet.'
        : 'A young person aged 13 to 15 signed up for a SparkKindly account with your email address as their parent or guardian. We need your OK before the account is kept.',
      '',
      'What the account holds:',
      ...CONSENT_HOLDS.map((h) => `- ${h}`),
      '',
      'What this account cannot do: post public comments, join communities, contribute content, create child profiles or have a profile page.',
      '',
      links.deletionDate
        ? `If you do nothing, the account and everything in it is deleted on ${links.deletionDate.toISOString().slice(0, 10)}.`
        : 'If you do nothing, the account and everything in it is deleted 30 days after the child confirmed their own email.',
      '',
      'To let the account stay, open this link and press the confirm button :',
      links.confirmUrl,
      '',
      'To delete the account and everything held, open this link and press the delete button:',
      links.withdrawUrl,
      '',
      'How we handle personal data:',
      links.privacyUrl,
      '',
      'If you were not expecting this, you can ignore it or use the delete link above.',
    ].join('\n'),
  };
}
