import type { EnvLike } from './env';

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';
const TIMEOUT_MS = 10_000;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('MAILERSEND_API_TOKEN and MAIL_FROM must be set to send email');
    this.name = 'EmailNotConfiguredError';
  }
}

export class EmailSendError extends Error {
  constructor(public readonly status: number) {
    super(`MailerSend rejected the message with status ${status}`);
    this.name = 'EmailSendError';
  }
}

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

type EmailDeps = { fetch?: typeof fetch; env?: EnvLike };

// Transactional email through MailerSend. Callers own retries; a failed send throws.
export async function sendEmail(
  msg: EmailMessage,
  { fetch: doFetch = globalThis.fetch, env = process.env }: EmailDeps = {},
): Promise<{ id: string }> {
  const token = env.MAILERSEND_API_TOKEN;
  const from = env.MAIL_FROM;
  if (!token || !from) throw new EmailNotConfiguredError();

  const res = await doFetch(MAILERSEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: from, name: 'SparkKindly' },
      to: [{ email: msg.to }],
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new EmailSendError(res.status);
  return { id: res.headers.get('x-message-id') ?? '' };
}
