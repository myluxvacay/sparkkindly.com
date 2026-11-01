// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { httpsProbe } from '@/lib/items/probe';
import { BlockedAddressError } from '@/lib/items/net-safety';

describe('httpsProbe', () => {
  it('refuses a name that resolves to a loopback address, before any connection is made', async () => {
    // "localhost" resolves through the hosts file with no network involved; the pinned lookup must reject it.
    await expect(httpsProbe('https://localhost:9/x', 'HEAD', AbortSignal.timeout(3000))).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('is cancelled by its abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(httpsProbe('https://example.org/', 'HEAD', controller.signal)).rejects.toThrow();
  });
});
