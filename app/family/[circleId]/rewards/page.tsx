import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle } from '@/lib/family-hub/repo';
import { listPendingRedemptions, listRewards } from '@/lib/family-hub/loops';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  added: { text: 'Reward added.', ok: true },
  'reward-ok': { text: 'Reward updated.', ok: true },
  decided: { text: 'Done.', ok: true },
  balance: { text: 'That reward costs more than the balance right now — the request stays waiting until there are enough points, or you can send it back.', ok: false },
  invalid: { text: 'Please check the form: a title and a whole number of points.', ok: false },
  limit: { text: 'The catalogue is full.', ok: false },
  no: { text: 'That could not be done.', ok: false },
};

export default async function RewardsPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const rewards = (await listRewards(db, circleId, ctx.account.id)) ?? [];
  const pending = (await listPendingRedemptions(db, circleId, ctx.account.id)) ?? [];

  return (
    <>
      <h1>Rewards — {circle.name}</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/chores/`}>Chores &amp; points</Link> ·{' '}
        <Link href={`/family/${circle.id}/meals/`}>Meals</Link> · <Link href={`/family/${circle.id}/kids/`}>Kids</Link>
      </p>
      <p>
        The catalogue is yours — experiences work best (&ldquo;pick Friday&rsquo;s movie&rdquo;, &ldquo;choose the weekend outing&rdquo;).
        Kids ask for a reward in their kid view; approving here is what spends the points.
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}

      <h2>Reward requests waiting ({pending.length})</h2>
      {pending.length === 0 ? (
        <p>No requests waiting.</p>
      ) : (
        <ul className="admin-list">
          {pending.map((x) => (
            <li key={x.id}>
              <strong>{x.kidName}</strong> asked for “{x.rewardTitle}” ({x.costPoints} points){' '}
              <form method="post" action={`/family/${circle.id}/rewards/decide/`} style={{ display: 'inline' }}>
                <input type="hidden" name="redemption_id" value={x.id} />
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve (−{x.costPoints})</button>
              </form>{' '}
              <form method="post" action={`/family/${circle.id}/rewards/decide/`} style={{ display: 'inline' }}>
                <input type="hidden" name="redemption_id" value={x.id} />
                <input type="hidden" name="action" value="decline" />
                <button type="submit">Send back</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>The catalogue</h2>
      {rewards.length === 0 ? (
        <p>No rewards yet — add the first one below.</p>
      ) : (
        <ul className="admin-list">
          {rewards.map((w) => (
            <li key={w.id}>
              {w.title} — {w.costPoints} points{w.active ? '' : ' (retired)'}{' '}
              <form method="post" action={`/family/${circle.id}/rewards/active/`} style={{ display: 'inline' }}>
                <input type="hidden" name="reward_id" value={w.id} />
                <input type="hidden" name="active" value={w.active ? 'false' : 'true'} />
                <button type="submit">{w.active ? 'Retire' : 'Restore'}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <h2>Add a reward</h2>
      <form method="post" action={`/family/${circle.id}/rewards/create/`}>
        <p>
          <label>
            Reward
            <br />
            <input name="title" required maxLength={80} />
          </label>
        </p>
        <p>
          <label>
            Costs (points) <input name="cost_points" type="number" min={1} max={100000} defaultValue={100} required />
          </label>
        </p>
        <button type="submit">Add reward</button>
      </form>
    </>
  );
}
