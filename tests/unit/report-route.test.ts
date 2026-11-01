// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/report/[world]/[slug]/submit/route';

const ctx = { params: Promise.resolve({ world: 'discover', slug: 'a-day-in-shadows' }) };
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/report/discover/a-day-in-shadows/submit/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  }), ctx);

describe('report POST body size', () => {
  it('refuses a declared body over the limit with 413 before reading it', async () => {
    const res = await post('reason=wrong', { 'content-length': String(10 * 1024 * 1024), 'x-forwarded-for': 'size-a' });
    expect(res.status).toBe(413);
  });

  it('refuses an oversized body that lies about its length, without buffering it all', async () => {
    const res = await post(`message=${'x'.repeat(64 * 1024)}`, { 'x-forwarded-for': 'size-b' });
    expect(res.status).toBe(413);
  });
});
