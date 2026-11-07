// Share links for an item page (owner request, "share with friends and family"). Pure, no Next.js imports. Every link
// is a plain anchor that works without JavaScript and sends nothing until clicked. The shared URL is the clean canonical
// item URL (no query string, so no tracking, session or answer state), and the text is the title with a neutral lead-in
// for quizzes and games: never an answer, a result or anything about the viewer.
// Child safety: a Kids item (world or audience) and a child context get no social-network links; a child context also
// gets no email or text link (only the device share and copy buttons, rendered by ShareClient).
// Verified by tests/unit/share-buttons.test.tsx.

export type ShareTarget = 'whatsapp' | 'sms' | 'email' | 'facebook' | 'x' | 'telegram';
export type ShareLink = { id: ShareTarget; label: string; href: string };
export type ShareInput = { world: string; slug: string; title: string; kind: string; audience: string };

const enc = encodeURIComponent;

export function shareUrl(baseUrl: string, item: { world: string; slug: string }): string {
  return `${baseUrl}/${enc(item.world)}/${enc(item.slug)}/`;
}

export function shareText(item: { title: string; kind: string }): string {
  return item.kind === 'article' ? item.title : `Can you get this one? ${item.title}`;
}

export const isKidsItem = (item: { world: string; audience: string }) => item.world === 'kids' || item.audience === 'kids';

export function shareLinks(baseUrl: string, item: ShareInput, childContext: boolean): ShareLink[] {
  const url = shareUrl(baseUrl, item);
  const text = shareText(item);
  const withUrl = `${text} ${url}`;
  const social = !childContext && !isKidsItem(item);
  return [
    ...(social ? [{ id: 'whatsapp' as const, label: 'WhatsApp', href: `https://wa.me/?text=${enc(withUrl)}` }] : []),
    ...(childContext
      ? []
      : [
          { id: 'sms' as const, label: 'Text message', href: `sms:?&body=${enc(withUrl)}` },
          { id: 'email' as const, label: 'Email', href: `mailto:?subject=${enc(item.title)}&body=${enc(withUrl)}` },
        ]),
    ...(social
      ? [
          { id: 'facebook' as const, label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
          { id: 'x' as const, label: 'X', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
          { id: 'telegram' as const, label: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
        ]
      : []),
  ];
}

// A scope without adults is a child context: a child profile, or a session lookup that failed closed to the child
// audiences (lib/accounts/scope.ts).
export const isChildScope = (scope: { audiences: readonly string[] }) => !scope.audiences.includes('adults');
