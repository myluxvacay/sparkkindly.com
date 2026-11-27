'use client';
// Turns the one-time invite token in the URL fragment (#i=…) into the copyable invite link.
// The fragment is never sent to a server; "Done" clears it from the address bar.
import { useState, useSyncExternalStore } from 'react';

const readHashToken = (): string | null => {
  const m = /#i=([0-9a-f]{32,})/.exec(window.location.hash);
  return m ? m[1] : null;
};
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export default function InviteLink() {
  const token = useSyncExternalStore(subscribe, readHashToken, () => null);
  const [dismissed, setDismissed] = useState(false);
  if (!token || dismissed) return null;
  const link = `${window.location.origin}/family/invite/${token}/`;
  return (
    <div id="result" style={{ border: '2px solid #6d28d9', borderRadius: 8, padding: 12, margin: '12px 0' }}>
      <p style={{ marginTop: 0 }}>
        <strong>Your invite link</strong> — share it with the adult you are inviting. It works once and expires in 7 days.
      </p>
      <p>
        <a href={link}>{link}</a>
      </p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(link);
        }}
      >
        Copy link
      </button>{' '}
      <button
        type="button"
        onClick={() => {
          history.replaceState(null, '', window.location.pathname + window.location.search);
          setDismissed(true);
        }}
      >
        Done
      </button>
    </div>
  );
}
