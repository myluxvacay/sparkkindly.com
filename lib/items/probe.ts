import https from 'node:https';
import { pinnedLookup } from './net-safety';

export type ProbeResult = { status: number; location: string | null };
export type Probe = (url: string, method: 'HEAD' | 'GET', signal: AbortSignal) => Promise<ProbeResult>;

// One HTTPS request that reports the status and Location header and nothing else. Redirects are NOT followed here
// (the caller follows them one hop at a time and re-checks each). The address is vetted inside the connection's own
// lookup, under the caller's abort signal, so the DNS lookup counts against the time budget and cannot be rebound.
export const httpsProbe: Probe = (url, method, signal) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        servername: u.hostname.replace(/\.+$/, ''),
        headers: { 'user-agent': 'SparkKindlyBot/1.0 (+https://sparkkindly.com)', accept: '*/*' },
        lookup: pinnedLookup(),
        signal,
      },
      (res) => {
        const location = res.headers.location;
        resolve({ status: res.statusCode ?? 0, location: typeof location === 'string' ? location : null });
        res.destroy(); // never download the body
      },
    );
    req.on('error', reject);
    req.end();
  });
