import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { listPromosAdmin, type Promo } from '@/lib/promos/repo';
import { PROMO_TYPES, streakConfig, type PromoType } from '@/lib/promos/types';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const BACK = '/admin/promos/';

// Promotions are data: everything on this page writes promo records through /admin/act/, and the public pages
// render whatever the records say. Creating, editing, activating (status live) and ending a promotion all
// take effect at once — no deployment. Exists only while promotions are switched on.

function Fields({ p, prefix }: { p?: Promo; prefix: string }) {
  const cfg = p ? streakConfig(p.config) : { targetDays: 10, freezeAllowance: 1, winnersPerDraw: 5 };
  const id = (n: string) => `${prefix}-${n}`;
  return (
    <>
      <p>
        <label htmlFor={id('slug')}>Address (lowercase letters, digits and hyphens)</label>
        <input id={id('slug')} name="slug" required maxLength={80} defaultValue={p?.slug} />
      </p>
      <p>
        <label htmlFor={id('type')}>Type</label>
        <select id={id('type')} name="type" defaultValue={p?.type ?? 'streak_draw'}>
          {Object.entries(PROMO_TYPES).map(([value, def]) => (
            <option key={value} value={value}>
              {def.label}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor={id('title')}>Title</label>
        <input id={id('title')} name="title" required maxLength={120} defaultValue={p?.title} />
      </p>
      <p>
        <label htmlFor={id('short')}>Short description (the index card and page intro)</label>
        <input id={id('short')} name="short_description" required maxLength={300} defaultValue={p?.shortDescription} />
      </p>
      <p>
        <label htmlFor={id('prize')}>Prize line</label>
        <input id={id('prize')} name="prize" maxLength={300} defaultValue={p?.prize} />
      </p>
      <p>
        <label htmlFor={id('share-title')}>Share title (optional — how the link is titled when shared; blank = the title)</label>
        <input id={id('share-title')} name="share_title" maxLength={120} defaultValue={p?.shareTitle ?? ''} />
      </p>
      <p>
        <label htmlFor={id('share-desc')}>Share description (optional — blank = the short description)</label>
        <input id={id('share-desc')} name="share_description" maxLength={300} defaultValue={p?.shareDescription ?? ''} />
      </p>
      <p>
        <label htmlFor={id('share-image')}>Share image path (optional — a 1200×630 image on this site, e.g. /images/promos/share-streak.jpg; blank = the promotions card)</label>
        <input id={id('share-image')} name="share_image" maxLength={300} defaultValue={p?.shareImage ?? ''} />
      </p>
      <p>
        <label htmlFor={id('starts')}>Starts on (YYYY-MM-DD, blank = no start bound)</label>
        <input id={id('starts')} name="starts_on" maxLength={10} defaultValue={p?.startsOn ?? ''} />
      </p>
      <p>
        <label htmlFor={id('ends')}>Ends on (YYYY-MM-DD, blank = no end bound)</label>
        <input id={id('ends')} name="ends_on" maxLength={10} defaultValue={p?.endsOn ?? ''} />
      </p>
      <p>
        <label htmlFor={id('body')}>How it works (blank line between paragraphs)</label>
        <textarea id={id('body')} name="body" rows={8} maxLength={8000} defaultValue={p?.body} />
      </p>
      <p>
        <label htmlFor={id('rules')}>Official rules (blank line between paragraphs)</label>
        <textarea id={id('rules')} name="rules" rows={10} maxLength={12000} defaultValue={p?.rules} />
      </p>
      <fieldset>
        <legend>Streak settings (streak draw type only)</legend>
        <p>
          <label htmlFor={id('target')}>Days in a row to complete</label>
          <input id={id('target')} name="target_days" inputMode="numeric" maxLength={3} defaultValue={cfg.targetDays} />
        </p>
        <p>
          <label htmlFor={id('freeze')}>Streak-freezes per attempt</label>
          <input id={id('freeze')} name="freeze_allowance" inputMode="numeric" maxLength={3} defaultValue={cfg.freezeAllowance} />
        </p>
        <p>
          <label htmlFor={id('winners')}>Winners per monthly draw</label>
          <input id={id('winners')} name="winners_per_draw" inputMode="numeric" maxLength={3} defaultValue={cfg.winnersPerDraw} />
        </p>
      </fieldset>
    </>
  );
}

function StatusForm({ admin, p, status, label }: { admin: { csrf: string }; p: Promo; status: string; label: string }) {
  if (p.status === status) return null;
  return (
    <form method="post" action="/admin/act/" className="admin-inline">
      <input type="hidden" name="csrf" value={admin.csrf} />
      <input type="hidden" name="action" value="promo.status" />
      <input type="hidden" name="return" value={BACK} />
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="text-button">
        {label}
      </button>
    </form>
  );
}

export default async function AdminPromosPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!promosEnabled()) notFound();
  const { done, error } = await searchParams;
  const promos = await listPromosAdmin(getDb());
  return (
    <>
      <h1>Promotions</h1>
      <StatusNote done={done} error={error} />
      <p className="muted">
        A promotion is a record, not a release: create it here, edit it here, set it live here, end it here. The
        public pages at <Link href="/promos/">/promos/</Link> show whatever is live.
      </p>
      <section aria-labelledby="new-promo">
        <h2 id="new-promo">New promotion</h2>
        <form method="post" action="/admin/act/" className="admin-form">
          <input type="hidden" name="csrf" value={admin.csrf} />
          <input type="hidden" name="action" value="promo.create" />
          <input type="hidden" name="return" value={BACK} />
          <Fields prefix="new" />
          <button type="submit" className="button">
            Create as draft
          </button>
        </form>
      </section>
      <section aria-labelledby="all-promos">
        <h2 id="all-promos">All promotions ({promos.length})</h2>
        <ul className="admin-list">
          {promos.map((p) => (
            <li key={p.id}>
              <p>
                <strong>{p.title}</strong> — /promos/{p.slug}/ · {PROMO_TYPES[p.type as PromoType]?.label ?? p.type} ·{' '}
                <strong>{p.status}</strong>
                {p.status === 'live' && (
                  <>
                    {' '}
                    · <Link href={`/promos/${p.slug}/`}>View the public page</Link>
                  </>
                )}
                {p.type === 'streak_draw' && (
                  <>
                    {' '}
                    · <Link href={`/admin/promos/draw/?promo=${p.slug}`}>Entrants &amp; draw</Link>
                  </>
                )}
              </p>
              <p>
                <StatusForm admin={admin} p={p} status="live" label="Set live" />{' '}
                <StatusForm admin={admin} p={p} status="draft" label="Back to draft" />{' '}
                <StatusForm admin={admin} p={p} status="ended" label="End promotion" />
              </p>
              <details>
                <summary>Edit “{p.title}”</summary>
                <form method="post" action="/admin/act/" className="admin-form">
                  <input type="hidden" name="csrf" value={admin.csrf} />
                  <input type="hidden" name="action" value="promo.update" />
                  <input type="hidden" name="return" value={BACK} />
                  <input type="hidden" name="id" value={p.id} />
                  <Fields p={p} prefix={p.slug} />
                  <button type="submit" className="button">
                    Save changes
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
