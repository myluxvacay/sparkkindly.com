'use client';
import { useState, useSyncExternalStore } from 'react';
import ShareIcon from './ShareIcon';

// The progressive part of "Share this": a device share button (only where navigator.share exists) and a copy-link
// button with a polite confirmation. Renders nothing until JavaScript runs, so the no-JS page keeps only the plain
// links. No storage, no network: the browser's own share sheet and clipboard do the work.
const noop = () => () => {};

export default function ShareClient({ url, title, text }: { url: string; title: string; text: string }) {
  // False on the server and in the first render, true once hydrated: the buttons exist only with JavaScript.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const [message, setMessage] = useState('');
  if (!ready) return null;
  const canShare = typeof navigator.share === 'function';

  const share = () => navigator.share({ title, text, url }).catch(() => undefined);
  const copy = () =>
    navigator.clipboard
      .writeText(url)
      .then(() => setMessage('Link copied'))
      .catch(() => setMessage('Could not copy the link. Select the address bar and copy it from there.'));

  return (
    <div className="share-client">
      {canShare && (
        <button type="button" className="button share-btn" onClick={share}>
          <ShareIcon id="share" />
          Share…
        </button>
      )}
      {typeof navigator.clipboard?.writeText === 'function' && (
        <button type="button" className="button share-btn" onClick={copy}>
          <ShareIcon id="copy" />
          Copy link
        </button>
      )}
      {/* aria-live without role="status": the page keeps one status role, its quiz result. */}
      <p aria-live="polite" className="muted">
        {message}
      </p>
    </div>
  );
}
