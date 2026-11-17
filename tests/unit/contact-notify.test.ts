// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { notifyOwnerOfContact } from '@/lib/contact/notify';
import { EmailNotConfiguredError, EmailSendError, type EmailMessage } from '@/lib/email';
import type { StoredContact } from '@/lib/contact/submit';

const contact: StoredContact = { name: 'Jo Reader', email: 'jo@example.com', topic: 'sponsorship', message: 'We would like to sponsor the Play world.' };

describe('notifyOwnerOfContact', () => {
  it('emails the stored message to the owner mailbox', async () => {
    const sent: EmailMessage[] = [];
    const send = vi.fn(async (m: EmailMessage) => {
      sent.push(m);
      return { id: 'm-1' };
    });
    expect(await notifyOwnerOfContact(contact, { send, to: 'owner@example.com' })).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toContain('Sponsorship');
    expect(sent[0].text).toContain('Jo Reader <jo@example.com>');
    expect(sent[0].text).toContain('We would like to sponsor the Play world.');
  });

  it('is unconfigured, and sends nothing, when no owner mailbox is set', async () => {
    const send = vi.fn(async () => ({ id: 'x' }));
    expect(await notifyOwnerOfContact(contact, { send, to: null })).toBe('unconfigured');
    expect(send).not.toHaveBeenCalled();
  });

  it('is unconfigured when MailerSend itself is not configured', async () => {
    const send = vi.fn(async () => {
      throw new EmailNotConfiguredError();
    });
    expect(await notifyOwnerOfContact(contact, { send, to: 'owner@example.com' })).toBe('unconfigured');
  });

  it('reports failure without throwing when MailerSend rejects the send', async () => {
    const send = vi.fn(async () => {
      throw new EmailSendError(500);
    });
    await expect(notifyOwnerOfContact(contact, { send, to: 'owner@example.com' })).resolves.toBe('failed');
  });
});
