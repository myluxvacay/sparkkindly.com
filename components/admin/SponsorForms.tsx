import { ALLOWED_CATEGORIES, EXCLUDED_CATEGORIES } from '@/lib/sponsorship/rules';
import type { AdminSponsor } from '@/lib/sponsorship/admin';

// The two sponsorship forms on /admin/sponsors/ (plan 6): a new sponsor (allowed categories only, the excluded list shown
// beside them, and the required confirmation), and attaching a sponsorship to one item, topic or world.
const RETURN = '/admin/sponsors/';

function Hidden({ csrf, action }: { csrf: string; action: string }) {
  return (
    <>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="return" value={RETURN} />
    </>
  );
}

export function NewSponsorForm({ csrf }: { csrf: string }) {
  return (
    <form method="post" action="/admin/act/" className="admin-form">
      <Hidden csrf={csrf} action="sponsor.create" />
      <p>
        <label htmlFor="sp-name">Name (up to 80 characters)</label>
        <input id="sp-name" name="name" required maxLength={80} />
      </p>
      <p>
        <label htmlFor="sp-link">Link (https, a public site)</label>
        <input id="sp-link" name="link" type="url" required maxLength={500} />
      </p>
      <p>
        <label htmlFor="sp-category">Category</label>
        <select id="sp-category" name="category" required>
          {ALLOWED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </p>
      <p className="muted">Never accepted: {EXCLUDED_CATEGORIES.join(', ')}.</p>
      <p>
        <input id="sp-confirm" name="confirmed" type="checkbox" required />{' '}
        <label htmlFor="sp-confirm">This sponsor is not in an excluded category and is not marketed to children.</label>
      </p>
      <button type="submit" className="button">
        Save sponsor
      </button>
    </form>
  );
}

export function AttachForm({ csrf, sponsors }: { csrf: string; sponsors: AdminSponsor[] }) {
  return (
    <form method="post" action="/admin/act/" className="admin-form">
      <Hidden csrf={csrf} action="sponsorship.attach" />
      <p>
        <label htmlFor="ss-sponsor">Sponsor</label>
        <select id="ss-sponsor" name="sponsor" required>
          {sponsors
            .filter((s) => s.confirmed)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </p>
      <p>
        <label htmlFor="ss-target">Attach to</label>
        <select id="ss-target" name="target" required>
          <option value="topic">A topic (its address)</option>
          <option value="world">A world (its address, not Kids)</option>
          <option value="item">One item (world/slug)</option>
        </select>
      </p>
      <p>
        <label htmlFor="ss-ref">Topic, world or item address</label>
        <input id="ss-ref" name="ref" required maxLength={200} />
      </p>
      <p>
        <label htmlFor="ss-label">Link text (up to 60 characters)</label>
        <input id="ss-label" name="label" required maxLength={60} />
      </p>
      <p>
        <label htmlFor="ss-kind">Kind (sets the fixed disclosure sentence)</label>
        <select id="ss-kind" name="kind" required>
          <option value="supported">Supported by the sponsor</option>
          <option value="affiliate">Affiliate link (we earn a commission)</option>
        </select>
      </p>
      <p>
        <label htmlFor="ss-start">First day (UTC, optional)</label>
        <input id="ss-start" name="starts_on" type="date" />
      </p>
      <p>
        <label htmlFor="ss-end">Last day (UTC, optional)</label>
        <input id="ss-end" name="ends_on" type="date" />
      </p>
      <button type="submit" className="button">
        Attach sponsorship
      </button>
    </form>
  );
}
