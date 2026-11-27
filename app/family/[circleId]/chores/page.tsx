import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listKids } from '@/lib/family-hub/repo';
import {
  kidPoints, listChores, listLedger, listPendingCompletions,
} from '@/lib/family-hub/loops';
import { CADENCE_LABEL, CHORE_CADENCES } from '@/lib/family-hub/rules';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  added: { text: 'Chore added.', ok: true },
  'chore-ok': { text: 'Chore updated.', ok: true },
  decided: { text: 'Done — points land only when you approve, and they just did (or the mark was sent back).', ok: true },
  adjusted: { text: 'Points adjusted.', ok: true },
  balance: { text: 'That would take the balance below zero — points are recognition, not a debt.', ok: false },
  invalid: { text: 'Please check the form: a title, a rhythm, and a whole number of points.', ok: false },
  limit: { text: 'That list is full.', ok: false },
  no: { text: 'That could not be done.', ok: false },
};

export default async function ChoresPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];
  const chores = (await listChores(db, circleId, ctx.account.id)) ?? [];
  const pending = (await listPendingCompletions(db, circleId, ctx.account.id)) ?? [];
  const balances = new Map<string, number>();
  const ledgers = new Map<string, Awaited<ReturnType<typeof listLedger>>>();
  for (const k of kids) {
    balances.set(k.id, (await kidPoints(db, circleId, ctx.account.id, k.id)) ?? 0);
    ledgers.set(k.id, await listLedger(db, circleId, ctx.account.id, k.id, 5));
  }

  return (
    <>
      <h1>Chores &amp; points — {circle.name}</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/calendar/`}>Calendar</Link> ·{' '}
        <Link href={`/family/${circle.id}/runs/`}>Runs board</Link> · <Link href={`/family/${circle.id}/kids/`}>Kids</Link> ·{' '}
        <Link href={`/family/${circle.id}/rewards/`}>Rewards</Link> · <Link href={`/family/${circle.id}/meals/`}>Meals</Link>
      </p>
      <p>
        Kids mark chores done in their kid view; nothing counts until a grown-up approves it here — approval is what puts the
        points in. Points have no cash value and are never ranked between children.
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}

      <h2>Waiting for a grown-up ({pending.length})</h2>
      {pending.length === 0 ? (
        <p>Nothing waiting. When a kid marks a chore done, it shows up here.</p>
      ) : (
        <ul className="admin-list">
          {pending.map((c) => (
            <li key={c.id}>
              <strong>{c.kidName}</strong> — {c.choreTitle} ({c.points} points, {c.periodKey === 'once' ? 'one time' : c.periodKey}){' '}
              <form method="post" action={`/family/${circle.id}/chores/decide/`} style={{ display: 'inline' }}>
                <input type="hidden" name="completion_id" value={c.id} />
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve (+{c.points})</button>
              </form>{' '}
              <form method="post" action={`/family/${circle.id}/chores/decide/`} style={{ display: 'inline' }}>
                <input type="hidden" name="completion_id" value={c.id} />
                <input type="hidden" name="action" value="decline" />
                <button type="submit">Send back</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {kids.map((k) => (
        <section key={k.id}>
          <h2>
            {k.firstName} — {balances.get(k.id) ?? 0} points
          </h2>
          <ul className="admin-list">
            {chores.filter((c) => c.kidProfileId === k.id).map((c) => (
              <li key={c.id}>
                {c.title} — {CADENCE_LABEL[c.cadence]}, {c.points} points{c.active ? '' : ' (retired)'}{' '}
                <form method="post" action={`/family/${circle.id}/chores/active/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="chore_id" value={c.id} />
                  <input type="hidden" name="active" value={c.active ? 'false' : 'true'} />
                  <button type="submit">{c.active ? 'Retire' : 'Restore'}</button>
                </form>
              </li>
            ))}
          </ul>
          <details>
            <summary>Add a chore for {k.firstName}</summary>
            <form method="post" action={`/family/${circle.id}/chores/create/`}>
              <input type="hidden" name="kid_id" value={k.id} />
              <p>
                <label>
                  Chore
                  <br />
                  <input name="title" required maxLength={80} />
                </label>
              </p>
              <p>
                <label>
                  Rhythm{' '}
                  <select name="cadence" defaultValue="daily">
                    {CHORE_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {CADENCE_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>{' '}
                <label>
                  Points <input name="points" type="number" min={1} max={10000} defaultValue={10} required />
                </label>
              </p>
              <button type="submit">Add chore</button>
            </form>
          </details>
          <details>
            <summary>Adjust {k.firstName}&rsquo;s points</summary>
            <form method="post" action={`/family/${circle.id}/chores/adjust/`}>
              <input type="hidden" name="kid_id" value={k.id} />
              <p>
                <label>
                  Change (e.g. 20 or -5) <input name="delta" type="number" required />
                </label>
              </p>
              <p>
                <label>
                  Why (always written down)
                  <br />
                  <input name="note" required maxLength={300} />
                </label>
              </p>
              <button type="submit">Adjust points</button>
            </form>
          </details>
          {ledgers.get(k.id) && (ledgers.get(k.id) ?? []).length > 0 && (
            <>
              <h3>Recent points</h3>
              <ul className="admin-list">
                {(ledgers.get(k.id) ?? []).map((e) => (
                  <li key={e.id}>
                    {e.delta > 0 ? '+' : ''}
                    {e.delta} — {e.reason === 'chore_approval' ? 'chore approved' : e.reason === 'reward_redemption' ? 'reward' : 'adjustment'}
                    {e.note ? `: ${e.note}` : ''} <small>({e.createdAt.toLocaleDateString('en-US', { timeZone: circle.timeZone })})</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
      {kids.length === 0 && <p>Add a kid profile first — chores belong to a kid.</p>}
    </>
  );
}
