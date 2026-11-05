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

// headers: extra mail headers (List-Unsubscribe and List-Unsubscribe-Post, RFC 8058), sent as MailerSend name/value pairs.
export type EmailMessage = { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> };

type EmailDeps = { fetch?: typeof fetch; env?: EnvLike };

// Transactional email through MailerSend. Callers own retries; a failed send throws. One exception: MailerSend may
// refuse custom headers (HTTP 422, e.g. a plan without them), so a message with headers is retried once without them;
// the body's own unsubscribe link still goes out. Only the status is logged.
export async function sendEmail(
  msg: EmailMessage,
  { fetch: doFetch = globalThis.fetch, env = process.env }: EmailDeps = {},
): Promise<{ id: string }> {
  const token = env.MAILERSEND_API_TOKEN;
  const from = env.MAIL_FROM;
  if (!token || !from) throw new EmailNotConfiguredError();

  const post = (m: EmailMessage) =>
    doFetch(MAILERSEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: from, name: 'SparkKindly' },
        to: [{ email: m.to }],
        subject: m.subject,
        text: m.text,
        ...(m.html ? { html: m.html } : {}),
        ...(m.headers ? { headers: Object.entries(m.headers).map(([name, value]) => ({ name, value })) } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let res = await post(msg);
  if (res.status === 422 && msg.headers) {
    console.warn('email: custom headers refused (status 422); sent once more without them');
    res = await post({ ...msg, headers: undefined });
  }
  if (!res.ok) throw new EmailSendError(res.status);
  return { id: res.headers.get('x-message-id') ?? '' };
}
