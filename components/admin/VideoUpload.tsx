'use client';
// One file upload to a video job (plan 5B): the file is sent as the raw request body, so the server can stream it into
// quarantine and stop at the size limit without buffering it. Needs JavaScript (a plain form would send multipart);
// without it the form says so. The result message comes from the server's fixed list and is announced politely.
import { useState } from 'react';

type Props = { jobId: number; csrf: string; kind: 'video' | 'captions'; label: string; accept: string };

export default function VideoUpload({ jobId, csrf, kind, label, accept }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `upload-${kind}-${jobId}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return setMessage('Choose a file first.');
    setBusy(true);
    setMessage('Uploading…');
    try {
      const r = await fetch(`/admin/social/videos/${jobId}/upload/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-csrf': csrf,
          'x-upload-kind': kind,
          'x-file-name': encodeURIComponent(file.name),
          'x-declared-size': String(file.size),
        },
        body: file,
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; ok?: boolean };
      setMessage(j.message ?? 'The upload failed. Please try again.');
      if (j.ok) window.location.reload();
    } catch {
      setMessage('The upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-action" onSubmit={onSubmit}>
      <p>
        <label htmlFor={id}>{label}</label>
        <input id={id} name="file" type="file" accept={accept} required style={{ maxWidth: '100%' }} />
      </p>
      <noscript>
        <p>Uploading needs JavaScript in this browser.</p>
      </noscript>
      <button type="submit" className="button" disabled={busy}>
        Upload
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
