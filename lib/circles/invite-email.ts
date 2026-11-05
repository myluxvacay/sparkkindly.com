// The circle invite email, plain text (plan 4B). It names the inviter only by the name they chose in the circle, never
// their address. A recipient with an account gets the one-click unsubscribe from plan 3E. No Next.js imports;
// verified by tests/unit/circles-invite-web.test.ts.
import type { InviteMail } from './invites';

export function inviteEmail(
  m: InviteMail,
  links: { joinUrl: string; unsubscribeUrl: string | null },
): { subject: string; text: string } {
  return {
    subject: `${m.inviterName} invited you to ${m.circleName} on SparkKindly`,
    text: [
      `${m.inviterName} invited you to join their circle "${m.circleName}" on SparkKindly, where members play a short daily set of quizzes and games together.`,
      '',
      'To see the circle and join, open this link (it works once and expires in 14 days):',
      links.joinUrl,
      '',
      'Please ignore this if you do not know them. Nothing happens unless you open the link and join.',
      ...(links.unsubscribeUrl ? ['', 'To stop circle invite emails, open this link:', links.unsubscribeUrl] : []),
    ].join('\n'),
  };
}
