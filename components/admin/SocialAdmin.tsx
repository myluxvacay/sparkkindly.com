import Link from 'next/link';
import ActionForm from '@/components/admin/ActionForm';
import type { DistributionRow, Overview } from '@/lib/social/admin';
import { PLATFORMS } from '@/lib/social/states';

// The body of /admin/social/ (plan 5A): the "no credentials" banner, platform settings, hand-pick, recent posts with
// status, reason, links and errors (retry on failed, cancel on pending or failed), and visits from social links. Plain
// POST forms to /admin/act/; works without JavaScript. Credentials are shown as present or missing only.
const RETURN = '/admin/social/';
const NAME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
const SKIP: Record<string, string> = {
  cap_reached: 'not picked: the daily cap was reached',
  world_rotation: "not picked: another world's turn came first",
  not_playable: 'not picked: a quiz or game from its world went first',
  lower_topic_popularity: 'not picked: a more popular topic from its world went first',
};
const CANCELLABLE = new Set(['selected', 'copy_ready', 'scheduled', 'failed', 'flagged']);
const utc = (d: Date | null) => (d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '');

function Banner({ platforms }: Pick<Overview, 'platforms'>) {
  const missing = platforms.filter((p) => p.enabled && p.supported && !p.credentials);
  if (!missing.length) return null;
  return (
    <div role="alert" className="grown-ups">
      {missing.map((p) =>
        p.reauth ? (
          <p key={p.platform}>
            {NAME[p.platform]} needs re-authorisation: posting there has stopped until the owner signs in again (docs/OPERATIONS.md, Video
            jobs).
          </p>
        ) : (
          <p key={p.platform}>
            No credentials for {NAME[p.platform]}: nothing is posted there until the{' '}
            {p.platform === 'tiktok' || p.platform === 'youtube' ? `${NAME[p.platform]}` : 'Meta'} settings are in the server env file
            (docs/OPERATIONS.md, {p.platform === 'tiktok' || p.platform === 'youtube' ? 'Video jobs' : 'Social distribution'}).
          </p>
        ),
      )}
    </div>
  );
}

function PlatformForm({ csrf, p }: { csrf: string; p: Overview['platforms'][number] }) {
  const id = `sp-${p.platform}`;
  return (
    <li>
      <h3>{NAME[p.platform]}</h3>
      {!p.supported && <p className="muted">Posting to {NAME[p.platform]} comes with short video (Project 5B).</p>}
      {(p.platform === 'tiktok' || p.platform === 'youtube') && (
        <p className="muted">
          Video only: see <Link href="/admin/social/videos/">video jobs</Link>.
        </p>
      )}
      <ActionForm csrf={csrf} action="social.platform_set" returnTo={RETURN} label={`Save ${NAME[p.platform]}`} fields={{ platform: p.platform }}>
        <p>
          <label htmlFor={`${id}-on`}>Posting</label>
          <select id={`${id}-on`} name="enabled" defaultValue={String(p.enabled)}>
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        </p>
        <p>
          <label htmlFor={`${id}-cap`}>Posts a day (0 to 10)</label>
          <input id={`${id}-cap`} name="daily_cap" type="number" min={0} max={10} required defaultValue={p.dailyCap} />
        </p>
        <p>
          <label htmlFor={`${id}-time`}>Posting time (UTC, by 20:00)</label>
          <input id={`${id}-time`} name="post_time" type="time" max="20:00" required defaultValue={p.postTime} />
        </p>
      </ActionForm>
    </li>
  );
}

function PickForm({ csrf }: { csrf: string }) {
  return (
    <ActionForm csrf={csrf} action="social.pick" returnTo={RETURN} label="Pick for today">
      <p>
        <label htmlFor="pick-item">Item id</label>
        <input id="pick-item" name="item" required pattern="[0-9a-fA-F-]{36}" />
      </p>
      <p>
        <label htmlFor="pick-platform">Platform</label>
        <select id="pick-platform" name="platform">
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {NAME[p]}
            </option>
          ))}
        </select>
      </p>
    </ActionForm>
  );
}

function Row({ csrf, d }: { csrf: string; d: DistributionRow }) {
  const label = `${d.title} on ${d.platform}`;
  return (
    <li>
      <a href={`/${d.world}/${d.slug}/`}>{d.title}</a> · {d.platform} · {d.day} · <strong>{d.status.replace('_', ' ')}</strong>
      {d.skipReason && <> · {SKIP[d.skipReason] ?? d.skipReason}</>}
      {d.status === 'scheduled' && d.scheduledFor && <> · at {utc(d.scheduledFor)}</>}
      {d.postedAt && <> · posted {utc(d.postedAt)}</>}
      {d.postUrl && (
        <>
          {' '}
          · <a href={d.postUrl}>view post</a>
        </>
      )}
      {d.lastError && <p className="muted">{d.lastError}</p>}
      <div className="admin-actions">
        {d.status === 'failed' && (
          <ActionForm csrf={csrf} action="social.retry" returnTo={RETURN} label="Retry" plain fields={{ id: String(d.id) }} ariaLabel={`Retry: ${label}`} />
        )}
        {CANCELLABLE.has(d.status) && (
          <ActionForm csrf={csrf} action="social.cancel" returnTo={RETURN} label="Cancel" plain fields={{ id: String(d.id) }} ariaLabel={`Cancel: ${label}`} />
        )}
      </div>
    </li>
  );
}

export default function SocialAdmin({ csrf, overview }: { csrf: string; overview: Overview }) {
  const { platforms, distributions, visits } = overview;
  return (
    <>
      <Banner platforms={platforms} />
      <section aria-labelledby="social-posts">
        <h2 id="social-posts">Posts, last 7 days ({distributions.length})</h2>
        <p className="muted">Failed, flagged and in-flight posts stay listed until handled. Flagged means: check the platform yourself.</p>
        <ul className="admin-list">
          {distributions.map((d) => (
            <Row key={d.id} csrf={csrf} d={d} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="social-pick">
        <h2 id="social-pick">Hand-pick an item</h2>
        <p className="muted">Skips the world rotation; Kids items, unpublished items and the daily cap are still refused.</p>
        <PickForm csrf={csrf} />
      </section>
      <section aria-labelledby="social-visits">
        <h2 id="social-visits">Visits from social links, last 30 days</h2>
        <ul className="admin-list">
          {visits.map((v) => (
            <li key={`${v.platform}-${v.world}-${v.slug}`}>
              <a href={`/${v.world}/${v.slug}/`}>{v.title}</a> · {v.platform} · {v.visits} {v.visits === 1 ? 'visit' : 'visits'}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="social-platforms">
        <h2 id="social-platforms">Platforms</h2>
        <ul className="admin-list">
          {platforms.map((p) => (
            <PlatformForm key={p.platform} csrf={csrf} p={p} />
          ))}
        </ul>
      </section>
    </>
  );
}
