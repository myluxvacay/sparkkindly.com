// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/(trust)/contact/submit/route';

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/contact/submit/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body,
    }),
  );

describe('contact POST guards', () => {
  it('refuses a declared body over the limit with 413 before reading it', async () => {
    const res = await post('topic=general', { 'content-length': String(10 * 1024 * 1024), 'x-forwarded-for': 'size-a' });
    expect(res.status).toBe(413);
  });

  it('refuses an oversized body that lies about its length, without buffering it all', async () => {
    const res = await post(`message=${'x'.repeat(64 * 1024)}`, { 'x-forwarded-for': 'size-b' });
    expect(res.status).toBe(413);
  });

  it('refuses a non-form content type with 415', async () => {
    const res = await post('{}', { 'content-type': 'application/json', 'x-forwarded-for': 'size-c' });
    expect(res.status).toBe(415);
  });

  it('refuses a foreign Origin with 403', async () => {
    const res = await post('topic=general&email=a@b.co&message=hi', { origin: 'https://evil.example', 'x-forwarded-for': 'size-d' });
    expect(res.status).toBe(403);
  });
});
