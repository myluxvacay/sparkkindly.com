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
  it('passes custom headers (List-Unsubscribe) as MailerSend name/value pairs, only when given', async () => {
    const fetch = vi.fn(async (..._args: FetchArgs) => new Response(null, { status: 202 }));
    const headers = { 'List-Unsubscribe': '<https://x.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y', headers }, { fetch, env });
    expect(JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string).headers).toEqual([
      { name: 'List-Unsubscribe', value: '<https://x.test/u>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('retries once without custom headers when MailerSend refuses them (422), logging only the status (final review 5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi
      .fn(async (..._args: FetchArgs) => new Response(null, { status: 202, headers: { 'x-message-id': 'm-2' } }))
      .mockImplementationOnce(async () => new Response('headers need a paid plan', { status: 422 }));
    const headers = { 'List-Unsubscribe': '<https://x.test/u>' };
    const r = await sendEmail({ to: 'a@example.com', subject: 'x', text: 'body with https://x.test/u', headers }, { fetch, env });
    expect(r).toEqual({ id: 'm-2' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string);
    expect(second.headers).toBeUndefined();
    expect(second.text).toBe('body with https://x.test/u');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toMatch(/422/);
    expect(warn.mock.calls[0].join(' ')).not.toMatch(/a@example\.com|x\.test|paid plan/);
    warn.mockRestore();
  });

  it('does not retry other failures, nor a second 422', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const headers = { 'List-Unsubscribe': '<https://x.test/u>' };
    const f500 = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', text: 'y', headers }, { fetch: f500, env })).rejects.toMatchObject({ status: 500 });
    expect(f500).toHaveBeenCalledTimes(1);
    const f422 = vi.fn(async () => new Response(null, { status: 422 }));
    await expect(sendEmail({ to: 'a@example.com', subject: 'x', text: 'y', headers }, { fetch: f422, env })).rejects.toMatchObject({ status: 422 });
    expect(f422).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
