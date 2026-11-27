import Link from 'next/link';
import { getDb } from '@/lib/db';
import { circleOr404, requireHubAdult } from '@/lib/family-hub/next';
import { getCircle, listKids } from '@/lib/family-hub/repo';
import {
  listFavourites, listGroceries, listMealRequests, listPlan,
} from '@/lib/family-hub/loops';
import { DEFAULT_DECLINE_MESSAGE, addDays, localDateString, mondayOf, weekOf } from '@/lib/family-hub/rules';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ circleId: string }>; searchParams: Promise<{ r?: string; w?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  'meal-accepted': { text: 'On the plan — add its groceries below if you shop from the list.', ok: true },
  'meal-declined': { text: 'Sent back with your note.', ok: true },
  'plan-added': { text: 'Added to the board.', ok: true },
  'plan-deleted': { text: 'Removed from the board.', ok: true },
  'fav-added': { text: 'Favourite added.', ok: true },
  'fav-deleted': { text: 'Favourite removed.', ok: true },
  'grocery-added': { text: 'On the grocery list.', ok: true },
  'grocery-ok': { text: 'Grocery list updated.', ok: true },
  invalid: { text: 'Please check the form.', ok: false },
  limit: { text: 'That list is full.', ok: false },
  no: { text: 'That could not be done.', ok: false },
};

const dayName = (dateStr: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${dateStr}T12:00:00Z`));

export default async function MealsPage({ params, searchParams }: Props) {
  const ctx = await requireHubAdult();
  const [{ circleId }, { r, w }] = await Promise.all([params, searchParams]);
  const db = getDb();
  const circle = circleOr404(await getCircle(db, circleId, ctx.account.id));
  const kids = (await listKids(db, circleId, ctx.account.id)) ?? [];
  const today = localDateString(new Date(), circle.timeZone);
  const monday = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(w) : mondayOf(today);
  const days = weekOf(monday);
  const plan = (await listPlan(db, circleId, ctx.account.id, monday, days[6])) ?? [];
  const groceries = (await listGroceries(db, circleId, ctx.account.id, plan.map((p) => p.id))) ?? [];
  const pending = (await listMealRequests(db, circleId, ctx.account.id, 'pending')) ?? [];
  const favourites = (await listFavourites(db, circleId, ctx.account.id)) ?? [];
  const noted = kids.filter((k) => k.dietaryNotes);

  return (
    <>
      <h1>Meal planner — {circle.name}</h1>
      <p>
        <Link href={`/family/${circle.id}/`}>Circle</Link> · <Link href={`/family/${circle.id}/chores/`}>Chores &amp; points</Link> ·{' '}
        <Link href={`/family/${circle.id}/rewards/`}>Rewards</Link> · <Link href={`/family/${circle.id}/kids/`}>Kids</Link>
      </p>
      <p>
        Kids request dinners from their kid view; accepting puts the meal on the board, and the board builds the grocery list.
      </p>
      {r && RESULTS[r] && (
        <p id="result" role={RESULTS[r].ok ? undefined : 'alert'}>
          {RESULTS[r].text}
        </p>
      )}

      {noted.length > 0 && (
        <>
          <h2>Good to know at planning time</h2>
          <ul className="admin-list">
            {noted.map((k) => (
              <li key={k.id}>
                <strong>{k.firstName}:</strong> {k.dietaryNotes}
              </li>
            ))}
          </ul>
          <p>
            <small>Notes you wrote on each kid&rsquo;s profile — shown only inside this circle.</small>
          </p>
        </>
      )}

      <h2>Dinner requests waiting ({pending.length})</h2>
      {pending.length === 0 ? (
        <p>No requests waiting.</p>
      ) : (
        <ul className="admin-list">
          {pending.map((m) => (
            <li key={m.id} style={{ marginBottom: 12 }}>
              <strong>{m.kidName}</strong> would love “{m.requestedText}”{m.desiredDay ? ` (hoping for ${dayName(m.desiredDay)})` : ''}
              <form method="post" action={`/family/${circle.id}/meals/decide/`}>
                <input type="hidden" name="request_id" value={m.id} />
                <input type="hidden" name="action" value="accept" />
                <label>
                  Put it on <input name="plan_date" type="date" defaultValue={m.desiredDay ?? today} required />
                </label>{' '}
                <button type="submit">Accept</button>
              </form>
              <form method="post" action={`/family/${circle.id}/meals/decide/`}>
                <input type="hidden" name="request_id" value={m.id} />
                <input type="hidden" name="action" value="decline" />
                <label>
                  A kind note back{' '}
                  <input name="decline_message" defaultValue={DEFAULT_DECLINE_MESSAGE} maxLength={300} size={42} />
                </label>{' '}
                <button type="submit">Send back</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>
        The week of {dayName(monday)}{' '}
        <small>
          (<Link href={`/family/${circle.id}/meals/?w=${addDays(monday, -7)}`}>previous week</Link> ·{' '}
          <Link href={`/family/${circle.id}/meals/`}>this week</Link> ·{' '}
          <Link href={`/family/${circle.id}/meals/?w=${addDays(monday, 7)}`}>next week</Link>)
        </small>
      </h2>
      {days.map((day) => (
        <section key={day}>
          <h3>
            {dayName(day)}
            {day === today ? ' — today' : ''}
          </h3>
          {plan.filter((p) => p.planDate === day).length === 0 ? (
            <p>Nothing planned.</p>
          ) : (
            <ul className="admin-list">
              {plan
                .filter((p) => p.planDate === day)
                .map((p) => (
                  <li key={p.id}>
                    {p.mealText}
                    {p.kidName ? ` (for ${p.kidName})` : ''}{' '}
                    <form method="post" action={`/family/${circle.id}/meals/plan-delete/`} style={{ display: 'inline' }}>
                      <input type="hidden" name="plan_id" value={p.id} />
                      <button type="submit">Remove</button>
                    </form>
                    <form method="post" action={`/family/${circle.id}/meals/grocery-add/`}>
                      <input type="hidden" name="plan_id" value={p.id} />
                      <label>
                        Needs <input name="item_text" required maxLength={80} size={18} />
                      </label>{' '}
                      <label>
                        How much <input name="quantity_text" maxLength={40} size={8} />
                      </label>{' '}
                      <button type="submit">Add to groceries</button>
                    </form>
                  </li>
                ))}
            </ul>
          )}
        </section>
      ))}
      <details>
        <summary>Plan a meal directly</summary>
        <form method="post" action={`/family/${circle.id}/meals/plan-create/`}>
          <p>
            <label>
              Day <input name="plan_date" type="date" defaultValue={today} required />
            </label>
          </p>
          <p>
            <label>
              Meal
              <br />
              <input name="meal_text" required maxLength={80} />
            </label>
          </p>
          <p>
            <label>
              For{' '}
              <select name="kid_id" defaultValue="">
                <option value="">The whole family</option>
                {kids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.firstName}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <button type="submit">Add to the board</button>
        </form>
      </details>

      <h2>Grocery list (this week)</h2>
      {groceries.length === 0 ? (
        <p>Nothing on the list yet — add ingredients from a planned meal above, or a one-off item here.</p>
      ) : (
        <ul className="admin-list">
          {groceries.map((g) => {
            const forPlan = plan.find((p) => p.id === g.mealPlanId);
            return (
              <li key={g.id}>
                {g.checked ? <s>{g.itemText}</s> : g.itemText}
                {g.quantityText ? ` — ${g.quantityText}` : ''}
                {forPlan ? ` (for ${forPlan.mealText}, ${dayName(forPlan.planDate)})` : ' (one-off)'}{' '}
                <form method="post" action={`/family/${circle.id}/meals/grocery-act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="item_id" value={g.id} />
                  <input type="hidden" name="action" value={g.checked ? 'uncheck' : 'check'} />
                  <button type="submit">{g.checked ? 'Put back' : 'Got it'}</button>
                </form>{' '}
                <form method="post" action={`/family/${circle.id}/meals/grocery-act/`} style={{ display: 'inline' }}>
                  <input type="hidden" name="item_id" value={g.id} />
                  <input type="hidden" name="action" value="delete" />
                  <button type="submit">Remove</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <form method="post" action={`/family/${circle.id}/meals/grocery-add/`}>
        <p>
          <label>
            One-off item <input name="item_text" required maxLength={80} />
          </label>{' '}
          <label>
            How much <input name="quantity_text" maxLength={40} size={8} />
          </label>{' '}
          <button type="submit">Add</button>
        </p>
      </form>

      <h2>Family favourites</h2>
      <p>Kids pick requests from this list in their kid view (they can also type their own idea).</p>
      {favourites.length === 0 ? (
        <p>No favourites yet.</p>
      ) : (
        <ul className="admin-list">
          {favourites.map((fv) => (
            <li key={fv.id}>
              {fv.title}{' '}
              <form method="post" action={`/family/${circle.id}/meals/favourite-delete/`} style={{ display: 'inline' }}>
                <input type="hidden" name="favourite_id" value={fv.id} />
                <button type="submit">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form method="post" action={`/family/${circle.id}/meals/favourite-create/`}>
        <p>
          <label>
            New favourite <input name="title" required maxLength={80} />
          </label>{' '}
          <button type="submit">Add favourite</button>
        </p>
      </form>
    </>
  );
}
