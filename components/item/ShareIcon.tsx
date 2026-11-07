// Small inline line icons for the share row. Inline SVG on purpose: no image request, no third-party asset, and the
// button's visible text label stays the accessible name (the icon is decorative).
const PATHS: Record<string, string> = {
  whatsapp:
    'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zM9 8.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z',
  sms: 'M4 4h16v12H8l-4 4V4z',
  email: 'M3 5h18v14H3zM3 6l9 7 9-7',
  facebook: 'M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v6h4v-6h3l1-4h-4V8.5',
  x: 'M4 4l16 16M20 4L4 20',
  telegram: 'M21 3L3 11l6 2 2 6 3-4 5 3z',
  copy: 'M9 9h11v11H9zM4 4h11v3M4 4v11h3',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v8h14v-8',
};

export default function ShareIcon({ id }: { id: string }) {
  const d = PATHS[id];
  if (!d) return null;
  return (
    <svg
      className="share-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
