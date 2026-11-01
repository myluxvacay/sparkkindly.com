import { describe, it, expect } from 'vitest';
import { sameOrigin, clientKey, clientPrefix, safeReturn, createSignInLimits, createCodeLimits, readForm } from '@/lib/admin/guard';

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

describe('clientPrefix', () => {
  it('keys IPv4 by the full address and IPv6 by its /64, mapping IPv4-in-IPv6 to IPv4', () => {
    expect(clientPrefix('203.0.113.9')).toBe('203.0.113.9');
    expect(clientPrefix('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    expect(clientPrefix('2001:DB8:1:2::7')).toBe('2001:db8:1:2');
    expect(clientPrefix('2001:db8::1')).toBe('2001:db8:0:0');
    expect(clientPrefix('::1')).toBe('0:0:0:0');
    expect(clientPrefix('unknown')).toBe('unknown');
  });

  it('keys IPv4 by /24 when asked (the code limiter)', () => {
    expect(clientPrefix('203.0.113.9', 24)).toBe('203.0.113');
    expect(clientPrefix('::ffff:203.0.113.9', 24)).toBe('203.0.113');
    expect(clientPrefix('2001:db8:1:2::7', 24)).toBe('2001:db8:1:2');
  });

  it('puts every malformed address in one shared unknown bucket', () => {
    for (const bad of ['not an ip', '999.1.1.1', '1.2.3.256', '1.2.3', '1.2.3.4.5', '01:02:03', 'gggg::1', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', '', 'a'.repeat(500)]) {
      expect(clientPrefix(bad), bad).toBe('unknown');
      expect(clientPrefix(bad, 24), bad).toBe('unknown');
    }
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
  const MIN = 60_000;

  it('spend only the per-client limit (10 an hour) for unknown addresses', () => {
    let t = 0;
    const decide = createSignInLimits(() => t);
    for (let i = 0; i < 10; i++) expect(decide('198.51.100.1', `u${i}@example.test`, false)).toBe('skip');
    expect(decide('198.51.100.1', 'owner@example.test', true)).toBe('skip'); // that client is over its limit
    expect(decide('198.51.100.2', 'owner@example.test', true)).toBe('new'); // the next IPv4 address is another client
    t += 60 * MIN;
    expect(decide('198.51.100.1', 'owner@example.test', true)).toBe('new');
  });

  it('treat one IPv6 /64 as one client', () => {
    const decide = createSignInLimits(() => 0);
    for (let i = 0; i < 10; i++) decide(`2001:db8:1:2::${i.toString(16)}`, `w${i}@example.test`, false);
    expect(decide('2001:db8:1:2:ffff:1:2:3', 'owner@example.test', true)).toBe('skip');
    expect(decide('2001:db8:1:3::1', 'owner@example.test', true)).toBe('new');
  });

  it('mint at most 3 new links an hour per allowed address, whoever asks, then re-send at most once per 5 minutes', () => {
    let t = 0;
    const decide = createSignInLimits(() => t);
    const got = [0, 1, 2, 3, 4].map((i) => decide(`192.0.2.${i}`, 'owner@example.test', true));
    expect(got).toEqual(['new', 'new', 'new', 'resend', 'skip']);
    t += 5 * MIN;
    expect(decide('192.0.2.9', 'owner@example.test', true)).toBe('resend');
    expect(decide('192.0.2.10', 'second@example.test', true)).toBe('new'); // another address has its own allowance
  });

  it('bounds the sends to one allowed address in an hour, however many networks flood it', () => {
    let t = 0;
    const decide = createSignInLimits(() => t);
    let sends = 0;
    for (let minute = 0; minute < 60; minute++, t += MIN) {
      for (let c = 0; c < 50; c++) {
        if (decide(`10.${minute}.0.${c}`, 'owner@example.test', true) !== 'skip') sends++;
      }
    }
    // The new-link bucket bursts 3 and refills 3 an hour (at most 6 in a 60-minute window); re-sends add at most 12.
    expect(sends).toBeLessThanOrEqual(6 + 12);
  });

  it('a flood from unknown addresses and from one /64 cannot stop a legitimate sign-in from another network', () => {
    let t = 0;
    const decide = createSignInLimits(() => t);
    for (let i = 0; i < 5000; i++) {
      decide(`2001:db8:dead:beef:${(i >> 16).toString(16)}:${(i & 0xffff).toString(16)}::1`, `j${i}@example.test`, false);
      decide(`198.18.${i >> 8}.${i & 255}`, `k${i}@example.test`, false);
    }
    for (let i = 0; i < 100; i++) decide(`2001:db8:dead:beef::${i.toString(16)}`, 'owner@example.test', true);
    expect(decide('203.0.113.5', 'owner@example.test', true)).toBe('new');
  });

  it('allow 20 code attempts an hour per client, where a client is an IPv4 /24 or IPv6 /64', () => {
    const allow = createCodeLimits(() => 0);
    for (let i = 0; i < 20; i++) expect(allow(`1.1.1.${i}`)).toBe(true);
    expect(allow('1.1.1.250')).toBe(false);
    expect(allow('1.1.2.1')).toBe(true);
  });

  it('malformed client addresses cannot mint extra code buckets', () => {
    const allow = createCodeLimits(() => 0);
    for (let i = 0; i < 20; i++) expect(allow(`junk-${i}`)).toBe(true);
    expect(allow('300.1.1.1')).toBe(false);
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
