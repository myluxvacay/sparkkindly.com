import { describe, it, expect } from 'vitest';
import { sameOrigin, clientKey, safeReturn, createSignInLimits, createCodeLimits, readForm } from '@/lib/admin/guard';

const req = (headers: Record<string, string>, body?: string) =>
  new Request('http://localhost:4173/admin/act/', { method: 'POST', headers, body });

describe('sameOrigin', () => {
  it('requires an Origin header whose host is this host', () => {
    expect(sameOrigin(req({ host: 'sparkkindly.com', origin: 'https://sparkkindly.com' }))).toBe(true);
    expect(sameOrigin(req({ host: 'sparkkindly.com' }))).toBe(false);
    expect(sameOrigin(req({ host: 'sparkkindly.com', origin: 'null' }))).toBe(false);
    expect(sameOrigin(req({ host: 'sparkkindly.com', origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(req({ host: 'sparkkindly.com', origin: 'https://sparkkindly.com.evil.example' }))).toBe(false);
    expect(sameOrigin(req({ host: 'sparkkindly.com', origin: 'not a url' }))).toBe(false);
  });
});

describe('clientKey', () => {
  it('takes the first X-Forwarded-For entry, else unknown', () => {
    expect(clientKey(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientKey(req({}))).toBe('unknown');
  });
});

describe('safeReturn', () => {
  it('keeps admin paths and sends everything else to /admin/', () => {
    expect(safeReturn('/admin/items/?status=draft')).toBe('/admin/items/?status=draft');
    expect(safeReturn('/admin/items/0b0e7a62-58c4-4c3f-9d6e-2b7f9f1d1a11/')).toBe('/admin/items/0b0e7a62-58c4-4c3f-9d6e-2b7f9f1d1a11/');
    for (const bad of ['//evil.example', 'https://evil.example/admin/', '/admin//evil.example', '/admin/\\evil', '/public/', '/admin', '', null, 42, '/admin/x\nSet-Cookie: a=b']) {
      expect(safeReturn(bad), String(bad)).toBe('/admin/');
    }
  });
});

describe('sign-in limits', () => {
  it('allow 10 requests an hour per client and 3 per address', () => {
    let t = 0;
    const allow = createSignInLimits(() => t);
    for (let i = 0; i < 3; i++) expect(allow('1.1.1.1', 'a@example.test')).toBe(true);
    expect(allow('1.1.1.1', 'a@example.test')).toBe(false);
    for (let i = 0; i < 6; i++) expect(allow('1.1.1.1', `x${i}@example.test`)).toBe(true);
    expect(allow('1.1.1.1', 'y@example.test')).toBe(false);
    expect(allow('2.2.2.2', 'b@example.test')).toBe(true);
    t += 60 * 60_000;
    expect(allow('1.1.1.1', 'z@example.test')).toBe(true);
  });

  it('allow 20 code attempts an hour per client', () => {
    const allow = createCodeLimits(() => 0);
    for (let i = 0; i < 20; i++) expect(allow('1.1.1.1')).toBe(true);
    expect(allow('1.1.1.1')).toBe(false);
    expect(allow('2.2.2.2')).toBe(true);
  });
});

describe('readForm', () => {
  it('parses a urlencoded body and refuses one over the cap or of another type', async () => {
    const ok = await readForm(req({ 'content-type': 'application/x-www-form-urlencoded' }, 'a=1&b=two'));
    expect(ok?.get('b')).toBe('two');
    expect(await readForm(req({ 'content-type': 'application/x-www-form-urlencoded' }, 'a='.padEnd(9000, 'x')))).toBeNull();
    expect(await readForm(req({ 'content-type': 'application/json' }, '{}'))).toBeNull();
  });
});
