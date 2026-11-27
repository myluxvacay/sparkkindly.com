'use client';
// Registers the SparkKindly service worker (public/sw.js, Phase 2.5). The worker never
// caches private surfaces (its own classifyRequest rule), so registering it site-wide
// is safe for signed-in family data. Registration failures are ignored — the site works
// exactly as before without the worker.
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
