'use client';
// Family Hub run alerts (Phase 2.5 Web Push). When the server has no VAPID keys, the
// card says so plainly and offers no button — push is dormant until the owner pastes
// the keys into the server env. When keys exist, this island reads the browser's own
// subscription state and posts subscribe/unsubscribe to the Hub's form endpoints
// (lib/family-hub/push-web.ts); the server stores rows against the signed-in account
// only. The test button is a plain form post, like every other Hub action.
import { useEffect, useState } from 'react';

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'working';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const post = async (path: string, fields: Record<string, string>): Promise<void> => {
  await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
};

export default function HubPushCard({ enabled, publicKey }: { enabled: boolean; publicKey: string | null }) {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (live) setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (live) setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (live) setState(sub ? 'on' : 'off');
    })().catch(() => {
      if (live) setState('unsupported');
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <section aria-label="Run alerts" style={{ border: '2px solid #ded4cb', borderRadius: 8, padding: 12, margin: '12px 0' }}>
        <h2 style={{ marginTop: 0 }}>Run alerts</h2>
        <p style={{ marginBottom: 0 }}>Notifications aren&rsquo;t switched on yet — they arrive once push is enabled on the server.</p>
      </section>
    );
  }

  const turnOn = async () => {
    if (!publicKey) return;
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));
      const json = sub.toJSON();
      await post('/family/push/subscribe/', {
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      });
      setState('on');
    } catch {
      setState('off');
    }
  };

  const turnOff = async () => {
    setState('working');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post('/family/push/unsubscribe/', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setState('on');
    }
  };

  return (
    <section aria-label="Run alerts" style={{ border: '2px solid #5b2c6f', borderRadius: 8, padding: 12, margin: '12px 0' }}>
      <h2 style={{ marginTop: 0 }}>Run alerts</h2>
      {state === 'loading' || state === 'working' ? (
        <p style={{ marginBottom: 0 }}>Checking this device&hellip;</p>
      ) : state === 'unsupported' ? (
        <p style={{ marginBottom: 0 }}>
          This browser can&rsquo;t receive push alerts. On an iPhone or iPad, alerts work once SparkKindly is added to the home screen.
        </p>
      ) : state === 'denied' ? (
        <p style={{ marginBottom: 0 }}>Notifications are blocked for this site in your browser settings, so run alerts can&rsquo;t reach this device.</p>
      ) : state === 'on' ? (
        <>
          <p>Run alerts are <strong>on</strong> for this device: you&rsquo;ll hear when a run in your circle needs a driver.</p>
          <p style={{ marginBottom: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={turnOff}>
              Turn off on this device
            </button>
            <form method="post" action="/family/push/test/" style={{ display: 'inline' }}>
              <button type="submit">Send a test notification</button>
            </form>
          </p>
        </>
      ) : (
        <>
          <p>Get a push on this device when a run in your circle needs a driver, so nothing is missed.</p>
          <p style={{ marginBottom: 0 }}>
            <button type="button" onClick={turnOn}>
              Turn on run alerts
            </button>
          </p>
        </>
      )}
    </section>
  );
}
