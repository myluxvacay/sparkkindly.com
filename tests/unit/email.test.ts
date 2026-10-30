import { describe, it, expect, vi } from 'vitest';
import { sendEmail, EmailNotConfiguredError } from '@/lib/email';

const env = { MAILERSEND_API_TOKEN: 'tok', MAIL_FROM: 'hello@sparkkindly.com' };
type FetchArgs = [input: URL | RequestInfo, init?: RequestInit];

describe('sendEmail', () => {
  it('posts to MailerSend with bearer token and returns the message id', async () => {
    const fetch = vi.fn(async (..._args: FetchArgs) =>
      new Response(null, { status: 202, headers: { 'x-message-id': 'm-1' } }),
    );
    const r = await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Hello' }, { fetch, env });
    expect(r).toEqual({ id: 'm-1' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailersend.com/v1/email');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      from: { email: 'hello@sparkkindly.com', name: 'SparkKindly' },
      to: [{ email: 'a@example.com' }],
      subject: 'Hi',
      text: 'Hello',
    });
  });

  it('includes html only when provided', async () => {
    const fetch = vi.fn(async (..._args: FetchArgs) => new Response(null, { status: 202 }));
    await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' }, { fetch, env });
    expect(JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string).html).toBe('<p>Hello</p>');
  });

  it('throws EmailNotConfiguredError without a token', async () => {
    await expect(
      sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, { fetch: vi.fn(), env: { MAIL_FROM: 'h@s.com' } }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('throws EmailSendError carrying the status on a non-2xx response', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 422 }));
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, { fetch, env })).rejects.toMatchObject({
      name: 'EmailSendError',
      status: 422,
    });
  });

  it('bounds the request with a timeout signal', async () => {
    const fetch = vi.fn(async (..._args: FetchArgs) => new Response(null, { status: 202 }));
    await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, { fetch, env });
    expect((fetch.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
