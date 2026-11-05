import type { CircleMember } from '@/lib/circles/repo';

type Child = { id: string; displayName: string };

// Adding a child shows the warning the spec requires before the confirm box; removing needs no confirmation.
export function ChildControls({ slug, addable, inCircle }: { slug: string; addable: Child[]; inCircle: CircleMember[] }) {
  if (addable.length === 0 && inCircle.length === 0) return null;
  return (
    <section aria-labelledby="children-heading" className="prose admin-form">
      <h2 id="children-heading">Your child profiles</h2>
      {addable.length > 0 && (
        <form method="post" action={`/circles/${slug}/add-child/`}>
          <p id="child-warning">
            Everyone in this circle sees the child profile&apos;s display name and its scores.
          </p>
          <p>
            <label htmlFor="profile_id">Child profile</label>
            <select id="profile_id" name="profile_id" required aria-describedby="child-warning">
              {addable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </p>
          <label className="admin-radio" htmlFor="confirm-child">
            <input type="checkbox" id="confirm-child" name="confirm" required aria-describedby="child-warning" /> I
            understand that everyone in this circle sees this display name and its scores
          </label>
          <button type="submit" className="button">
            Add to the circle
          </button>
        </form>
      )}
      {inCircle.map((m) => (
        <form method="post" action={`/circles/${slug}/remove-child/`} key={m.profileId} className="admin-actions">
          <input type="hidden" name="profile_id" value={m.profileId ?? ''} />
          <button type="submit" className="button">
            Take {m.name} out of the circle
          </button>
        </form>
      ))}
    </section>
  );
}
