import { site } from '@/lib/config';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';
import { CONTACT_TOPICS, type StoredContact } from './submit';

export type NotifyResult = 'sent' | 'unconfigured' | 'failed';

type NotifyDeps = { send?: typeof sendEmail; to?: string | null };

// Emails one stored contact message to the site owner. The recipient is the published CONTACT_EMAIL mailbox —
// the one the owner confirmed they read (lib/config.ts); with it unset there is nowhere confirmed to send, so
// the message is store-only. Never throws: the message is already stored, so a mail failure must not fail the
// visitor's submission. Only the outcome is reported, and on failure only the MailerSend status is logged.
export async function notifyOwnerOfContact(contact: StoredContact, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const to = deps.to === undefined ? site.contactEmail : deps.to;
  if (!to) return 'unconfigured';
  const label = CONTACT_TOPICS.find(([value]) => value === contact.topic)?.[1] ?? 'Other';
  const send = deps.send ?? sendEmail;
  try {
    await send({
      to,
      subject: `SparkKindly contact — ${label}`,
      text: [
        `From: ${contact.name || '(no name given)'} <${contact.email}>`,
        `Topic: ${label}`,
        '',
        contact.message,
        '',
        'This message is also stored in the contact_messages table. To reply, write to the address above.',
      ].join('\n'),
    });
    return 'sent';
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) return 'unconfigured';
    console.error('contact notify: owner email failed', err instanceof EmailSendError ? `(MailerSend status ${err.status})` : '');
    return 'failed';
  }
}
