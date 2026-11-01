import { describe, it, expect } from 'vitest';
import { isPublicAddress, isSafeSourceUrl, vettedAddress, pinnedLookup, BlockedAddressError } from '@/lib/items/net-safety';

describe('isPublicAddress', () => {
  it('accepts public IPv4 and IPv6 addresses', () => {
    for (const ok of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
  });

  it('refuses private, loopback, link-local, CGNAT, metadata, documentation and reserved IPv4', () => {
    for (const bad of ['0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.0.1', '169.254.169.254', '172.16.0.1',
      '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.0.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
      '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255']) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
    expect(isPublicAddress('172.15.0.1')).toBe(true);
    expect(isPublicAddress('172.32.0.1')).toBe(true);
  });

  it('refuses private IPv6 and every form that embeds a private IPv4', () => {
    for (const bad of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1', '3fff::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::127.0.0.1', '::7f00:1',
      '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:c0a8:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:10::1']) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it('refuses anything it cannot parse', () => {
    for (const bad of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1:2:3:4:5:6:7:8:9', ':::', '12345::1']) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

describe('isSafeSourceUrl', () => {
  it('refuses hosts that dodge plain checks', () => {
    for (const bad of ['https://localhost./x', 'https://LOCALHOST/x', 'https://127.0.0.1./x', 'https://example.123/x', 'https://intranet/x',
      'https://[::1]/x', 'https://2130706433/x', 'https://user@169.254.169.254/x', 'https://user:pw@example.org/x', 'http://example.org/x',
      'https://printer.local/x', 'https://db.internal/x', 'ftp://example.org/x', 'not a url']) {
      expect(isSafeSourceUrl(bad), bad).toBe(false);
    }
    expect(isSafeSourceUrl('https://www.nasa.gov/a')).toBe(true);
    expect(isSafeSourceUrl('https://sub.example.org./a')).toBe(true);
  });
});

describe('vettedAddress', () => {
  const answers = (...a: string[]) => async () => a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('returns the first address when every answer is public', async () => {
    expect(await vettedAddress('example.org', answers('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'))).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('throws BlockedAddressError when any answer is private', async () => {
    await expect(vettedAddress('private.example.org', answers('10.0.0.5'))).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(vettedAddress('mixed.example.org', answers('93.184.216.34', '127.0.0.1'))).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('throws when the name has no address', async () => {
    await expect(vettedAddress('nothing.example.org', answers())).rejects.toThrow(/no address/i);
  });

  it('strips a trailing dot before resolving', async () => {
    let asked = '';
    await vettedAddress('example.org.', async (h) => { asked = h; return [{ address: '93.184.216.34', family: 4 }]; });
    expect(asked).toBe('example.org');
  });
});

describe('pinnedLookup', () => {
  const resolver = (address: string) => async () => [{ address, family: 4 }];
  const call = (lookup: ReturnType<typeof pinnedLookup>, opts: object) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) =>
      lookup('example.org', opts, (err: Error | null, address: unknown, family?: number) => resolve({ err, result: family === undefined ? address : [address, family] })));

  it('hands back exactly the vetted address as a single result', async () => {
    const r = await call(pinnedLookup(resolver('93.184.216.34')), {});
    expect(r.err).toBeNull();
    expect(r.result).toEqual(['93.184.216.34', 4]);
  });

  it('hands back an array when the caller asks for all addresses', async () => {
    const r = await call(pinnedLookup(resolver('93.184.216.34')), { all: true });
    expect(r.result).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('fails the connection when the address is private', async () => {
    const r = await call(pinnedLookup(resolver('127.0.0.1')), {});
    expect(r.err).toBeInstanceOf(BlockedAddressError);
  });
});
