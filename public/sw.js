// SparkKindly service worker (Phase 2.5 PWA, 27 Nov 2026). Hand-rolled, no dependencies.
//
// THE PRIVACY RULE THIS FILE EXISTS TO KEEP: private surfaces are NEVER cached — not the
// Family Hub (/family/), not account pages (/account/), not the admin area, not any API
// response. A family's circle data must never sit in a browser cache where a shared
// device could serve it back. Private requests are not even intercepted: the browser
// talks to the network directly, exactly as if this worker did not exist.
// Static assets are cache-first under a versioned cache name; public pages are
// network-first with the cache only as an offline fallback, and a response carrying
// Set-Cookie is never stored. Bump SW_VERSION to retire every old cache on activate.
const SW_VERSION = 'v1';
const STATIC_CACHE = `sk-static-${SW_VERSION}`;

// [classify-start]
// Pure URL classification — the single source of truth for the caching boundary.
// tests/unit/pwa.test.ts extracts and exercises THIS function from the served file.
// Returns 'network-only' | 'cache-first' | 'network-first' for a URL pathname.
function classifyRequest(pathname) {
  const p = typeof pathname === 'string' ? pathname : '/';
  // Private and dynamic surfaces: never cached, never intercepted.
  if (
    p === '/sw.js' ||
    p.startsWith('/family') ||
    p.startsWith('/account') ||
    p.startsWith('/admin') ||
    p.startsWith('/api/')
  ) {
    return 'network-only';
  }
  // Fingerprinted framework assets and the site's own static folders.
  if (
    p.startsWith('/_next/static/') ||
    p.startsWith('/brand/') ||
    p.startsWith('/images/') ||
    p.startsWith('/fonts/') ||
    p.startsWith('/icons/') ||
    p.startsWith('/avatars/')
  ) {
    return 'cache-first';
  }
  // Static file extensions anywhere else (favicons, stray artwork).
  if (/\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/i.test(p)) {
    return 'cache-first';
  }
  // Everything else is a public page: fresh from the network when possible.
  return 'network-first';
}
// [classify-end]

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SparkKindly — offline</title>' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="font-family:system-ui,sans-serif;background:#fffcf7;color:#302438;padding:2rem;max-width:34rem;margin:auto">' +
  '<h1 style="color:#5b2c6f">You are offline</h1>' +
  '<p>SparkKindly needs a connection for your family&rsquo;s latest schedule. Reconnect and try again.</p>' +
  '</body></html>';

self.addEventListener('install', (event) => {
  // Nothing private is precached — the worker only ever fills its cache with static
  // assets and public pages it has actually served. Take over promptly: with no
  // private data in any cache, a fast swap can never serve the wrong family's data.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const kind = classifyRequest(url.pathname);

  if (kind === 'network-only') {
    // Not intercepted at all — the strongest form of the privacy rule.
    return;
  }

  if (kind === 'cache-first') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok && !res.headers.has('set-cookie')) {
          cache.put(request, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // network-first (public pages): fresh copy wins; cache is only an offline fallback.
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        const res = await fetch(request);
        if (res.ok && !res.headers.has('set-cookie')) {
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        const hit = await cache.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') {
          return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })(),
  );
});

// Web Push (Phase 2.5): payloads are JSON { title, body, url } composed server-side in
// lib/family-hub/push.ts. They carry first names only — never an address or location.
self.addEventListener('push', (event) => {
  let data = { title: 'SparkKindly', body: '', url: '/family/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/family/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/family/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.includes('/family')) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
