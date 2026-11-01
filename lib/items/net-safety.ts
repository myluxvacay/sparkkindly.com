import { lookup as dnsLookup } from 'node:dns/promises';

export class BlockedAddressError extends Error {
  constructor(public readonly host: string) {
    super(`${host} resolves to a private or reserved address and may not be fetched`);
    this.name = 'BlockedAddressError';
  }
}

const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// Eight 16-bit groups, or null when the text is not a valid IPv6 address (including dotted-quad tails and "::").
function parseIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${s.slice(0, -dotted[1].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

// True only for an address on the public internet. IPv4 private, loopback, link-local (cloud metadata), CGNAT,
// documentation, multicast and reserved ranges are refused. IPv6 is allowed only inside global unicast (2000::/3),
// minus 6to4, Teredo, ORCHID and documentation blocks; forms that embed an IPv4 (mapped, compatible, NAT64) are
// judged as the IPv4 they wrap. Anything unparsable is refused.
export function isPublicAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const g = parseIPv6(ip);
    if (!g) return false;
    const [h0, h1, h2, h3, h4, h5, h6, h7] = g;
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0xffff || h5 === 0)) return isPublicAddress(v4(h6, h7));
    if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return isPublicAddress(v4(h6, h7));
    if ((h0 & 0xe000) !== 0x2000) return false;
    if (h0 === 0x2002) return false;
    if (h0 === 0x2001 && (h1 === 0 || h1 === 0x0db8 || (h1 & 0xfff0) === 0x10 || (h1 & 0xfff0) === 0x20)) return false;
    if (h0 === 0x3fff && (h1 & 0xf000) === 0) return false;
    return true;
  }
  const p = ip.split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x))) return false;
  const [a, b, c] = p.map(Number);
  if (p.some((x) => Number(x) > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

// A source URL must be https, carry no credentials, and name a public site: no IP literals, no single-label or
// internal names, no numeric top level. This is a cheap first check; the connection itself is vetted by pinnedLookup.
export function isSafeSourceUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.+$/, ''); // "localhost." is localhost
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  const labels = host.split('.');
  return labels.length >= 2 && !/^\d+$/.test(labels[labels.length - 1]);
}

type Answer = { address: string; family: number };
type Resolver = (host: string) => Promise<Answer[]>;
const systemResolver: Resolver = (host) => dnsLookup(host, { all: true });

// Resolves a name and returns the address to connect to, refusing the name if ANY answer is not public.
export async function vettedAddress(host: string, resolve: Resolver = systemResolver): Promise<{ address: string; family: 4 | 6 }> {
  const name = host.replace(/\.+$/, '');
  const answers = await resolve(name);
  if (answers.length === 0) throw new Error(`no address found for ${name}`);
  if (!answers.every((a) => isPublicAddress(a.address))) throw new BlockedAddressError(name);
  return { address: answers[0].address, family: answers[0].family === 6 ? 6 : 4 };
}

type LookupCallback = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

// A `lookup` function for node:https. Because the connection asks THIS function for the address and uses exactly what it
// returns, the address that was checked is the address that is connected to: there is no gap for DNS rebinding.
export function pinnedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    vettedAddress(hostname, resolve).then(
      ({ address, family }) => (options?.all ? callback(null, [{ address, family }]) : callback(null, address, family)),
      (err: Error) => callback(err, '', 4),
    );
  };
}
