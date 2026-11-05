import type { InviteSection } from '@/lib/circles/invites';

// The circle page's invite section: the member's link (shown once, as selectable text, right after it is made; the
// database keeps only its hash), a regenerate button, the email form, and the active invites the viewer may revoke.
// Plain forms, no script needed.
export function InviteControls({ slug, section, base }: { slug: string; section: InviteSection; base: string }) {
  const action = (a: string) => `/circles/${slug}/invite/${a}/`;
  return (
    <section aria-labelledby="invites" className="prose admin-form">
      <h2 id="invites" tabIndex={-1}>
        Invite people
      </h2>
      {section.canInvite && (
        <>
          {section.link && (
            <p>
              <label htmlFor="invite-link">Your invite link (copy it now: it is shown only this once)</label>
              <input id="invite-link" readOnly value={`${base}/circles/join/${section.link}/`} aria-describedby="link-hint" />
            </p>
          )}
          <form method="post" action={action('link')}>
            <p id="link-hint">
              Anyone with your link can join until you make a new one. Making a new link stops the old one working.
            </p>
            <button type="submit" className="button">
              {section.hasLink ? 'Make a new invite link' : 'Make an invite link'}
            </button>
          </form>
          <form method="post" action={action('email')}>
            <p>
              <label htmlFor="invite-email">Invite by email</label>
              <input id="invite-email" name="email" type="email" required maxLength={254} aria-describedby="email-hint" />
            </p>
            <p id="email-hint" className="muted">
              The invite works once and expires in 14 days. We keep the address only until then.
            </p>
            <button type="submit" className="button">
              Send the invite
            </button>
          </form>
        </>
      )}
      {section.invites.length > 0 && (
        <>
          <h3>Active invites</h3>
          <ul className="admin-list">
            {section.invites.map((i) => (
              <li key={i.id}>
                <form method="post" action={action('revoke')} className="admin-actions">
                  <input type="hidden" name="invite_id" value={i.id} />
                  <p>
                    {i.kind === 'link' ? 'Invite link' : `Email invite${i.email ? ` to ${i.email}` : ''}`} by {i.by}
                    {i.expiresAt ? `, expires ${new Date(i.expiresAt).toISOString().slice(0, 10)}` : ''}
                  </p>
                  <button type="submit" className="button">
                    Revoke this invite
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
