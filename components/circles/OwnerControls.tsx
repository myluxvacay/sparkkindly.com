import type { CircleMember } from '@/lib/circles/repo';

// The owner's actions, each a plain form with a required confirm box (the server checks it too). No JS needed.
function Confirm({ id, text }: { id: string; text: string }) {
  return (
    <label className="admin-radio" htmlFor={id}>
      <input type="checkbox" id={id} name="confirm" required /> {text}
    </label>
  );
}

const keyOf = (m: CircleMember) => m.key ?? '';

export function OwnerControls({ slug, members }: { slug: string; members: CircleMember[] }) {
  const others = members.filter((m) => !m.isYou);
  const adults = others.filter((m) => !m.isChild);
  return (
    <section aria-labelledby="owner-heading" className="prose admin-form">
      <h2 id="owner-heading">Owner controls</h2>
      {others.length > 0 && <h3>Remove a member</h3>}
      {others.map((m) => (
        <form method="post" action={`/circles/${slug}/remove/`} key={keyOf(m)} className="admin-actions">
          <input type="hidden" name="member_key" value={keyOf(m)} />
          <Confirm id={`remove-${keyOf(m)}`} text={`Yes, remove ${m.name}`} />
          <button type="submit" className="button">
            Remove {m.name}
          </button>
        </form>
      ))}
      {adults.length > 0 && (
        <form method="post" action={`/circles/${slug}/transfer/`}>
          <h3>Make someone else the owner</h3>
          <p>
            <label htmlFor="to_member">New owner (adult members only)</label>
            <select id="to_member" name="to_member" required>
              {adults.map((m) => (
                <option key={keyOf(m)} value={keyOf(m)}>
                  {m.name}
                </option>
              ))}
            </select>
          </p>
          <Confirm id="confirm-transfer" text="Yes, hand over ownership" />
          <button type="submit" className="button">
            Transfer ownership
          </button>
        </form>
      )}
      <form method="post" action={`/circles/${slug}/close/`}>
        <h3>Close the circle</h3>
        <p>A closed circle cannot change any more. It is deleted, with everything in it, 30 days after closing.</p>
        <Confirm id="confirm-close" text="Yes, close this circle" />
        <button type="submit" className="button">
          Close the circle
        </button>
      </form>
    </section>
  );
}
