// Safety checks shared by scripts/url-inventory.ts and scripts/load-test.ts. Pure, so they are unit-tested.
// The host guard is an allow-list, not a deny-list: anything not named is refused, so a trailing dot, a capital letter,
// an IP literal or a lookalike name cannot slip past a production check.
const LOOPBACK = new Set(['localhost', '127.0.0.1']);

export type Target = { ok: true; url: URL; authAllowed: boolean } | { ok: false; reason: string };

export function checkTarget(base: string, opts: { allowed: string[] }): Target {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http and https are allowed' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in the URL are not allowed' };
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isIpLiteral && host !== '127.0.0.1') return { ok: false, reason: `IP literal ${host} is not allowed` };
  if (!opts.allowed.includes(host)) return { ok: false, reason: `host ${host} is not in the allow-list (${opts.allowed.join(', ')})` };
  return { ok: true, url, authAllowed: url.protocol === 'https:' || LOOPBACK.has(host) };
}

// A numeric option clamped to [min, max]; the fallback when absent; null when it is present but not a finite number.
export function parseBound(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}
