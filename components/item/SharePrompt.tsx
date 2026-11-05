import Link from 'next/link';
import { getContext } from '@/lib/accounts/context';
import { accountSessionToken } from '@/lib/accounts/scope-next';
import { linkBase } from '@/lib/admin/sessions';
import { sharePromptFor } from '@/lib/circles/share-prompt';
import { circlesEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';

// After an answer (plan 4D): for an adult-context member whose circle has this item in today's set, an invite link per
// circle and the item's public URL as selectable text. Renders nothing for anyone else (lib/circles/share-prompt.ts).
export default async function SharePrompt({ itemId }: { itemId: string }) {
  // Circles off: nothing to offer, and no session lookup at all (final review 6).
  if (!circlesEnabled()) return null;
  const token = await accountSessionToken();
  const now = new Date();
  const ctx = token ? await getContext(getDb(), token, now) : null;
  const prompt = ctx ? await sharePromptFor(getDb(), ctx, itemId, now, linkBase(process.env)) : null;
  if (!prompt) return null;
  return (
    <section aria-labelledby="share-heading" className="share-prompt">
      <h2 id="share-heading">Play it together</h2>
      {prompt.circles.length > 0 && (
        <ul>
          {prompt.circles.map((c) => (
            <li key={c.inviteHref}>
              <Link href={c.inviteHref}>Invite someone to {c.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="share-url">Share this game (copy the link)</label>
      <input id="share-url" type="text" readOnly value={prompt.shareUrl} />
    </section>
  );
}
