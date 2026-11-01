import { requireAdmin } from '@/lib/admin/next';
import { runHistory } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const when = (d: Date) => new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export default async function AdminRunsPage() {
  const admin = await requireAdmin();
  const h = await runHistory(getDb());
  return (
    <>
      <h1>Run history</h1>
      <p className="muted">Signed in as {admin.email}.</p>
      <section aria-labelledby="published">
        <h2 id="published">Items published by the worker, per day</h2>
        <ul>
          {h.publishedPerDay.map((d) => (
            <li key={d.day}>
              {d.day}: {d.n}
            </li>
          ))}
        </ul>
        {h.publishedPerDay.length === 0 && <p>None yet.</p>}
      </section>
      <section aria-labelledby="failed">
        <h2 id="failed">Failed jobs</h2>
        <ul>
          {h.failed.map((f, i) => (
            <li key={i}>
              {when(f.at)} · {f.job} · {f.attempts} attempts · {f.error}
            </li>
          ))}
        </ul>
        {h.failed.length === 0 && <p>No failures.</p>}
      </section>
      <section aria-labelledby="runs">
        <h2 id="runs">Daily jobs</h2>
        <ul>
          {h.runs.map((r) => (
            <li key={`${r.job}-${r.runKey}`}>
              {r.job} for {r.runKey} at {when(r.at)}
            </li>
          ))}
        </ul>
        {h.runs.length === 0 && <p>None yet.</p>}
      </section>
    </>
  );
}
