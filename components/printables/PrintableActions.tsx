'use client';
import { useState } from 'react';

// Print + share actions for printable pages and the /printables/ hub (owner direction, 22 Nov 2026:
// "Do social share so they come to site and download"). Every share points at the printable's PAGE
// on sparkkindly.com — never at an image or PDF asset — so a share brings the next family to the
// site to print or download it themselves. The buttons are plain anchors that work without
// JavaScript; only the copy-link button needs the island.
export function PrintButton({ label = 'Print this sheet' }: { label?: string }) {
  return (
    <button type="button" className="button" onClick={() => window.print()}>
      🖨 {label}
    </button>
  );
}

export function PrintableShare({
  url,
  title,
  text,
  mediaUrl,
}: {
  url: string;
  title: string;
  text: string;
  mediaUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const withText = `${text} ${url}`;
  const links = [
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    {
      id: 'pinterest',
      label: 'Pinterest',
      href: `https://pinterest.com/pin/create/button/?url=${enc(url)}${mediaUrl ? `&media=${enc(mediaUrl)}` : ''}&description=${enc(withText)}`,
    },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${enc(withText)}` },
    { id: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
  ];
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="share-buttons printable-share" aria-label={`Share: ${title}`}>
      <h2>Share this printable</h2>
      <p className="muted">Know a family or a classroom who would love it? Send them this page — printing and downloads are free.</p>
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
          </li>
        ))}
        <li>
          <button type="button" className="share-copy" onClick={copy} aria-live="polite">
            {copied ? 'Link copied ✓' : 'Copy link'}
          </button>
        </li>
      </ul>
    </section>
  );
}
