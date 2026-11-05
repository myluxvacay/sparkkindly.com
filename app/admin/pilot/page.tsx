import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { operatingEffort, pilotMetrics, recentHours, type Metric } from '@/lib/admin/pilot';
import { pointsCorrect } from '@/lib/circles/points';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const BACK = '/admin/pilot/';

function verdict(m: { met: boolean | null }) {
  return m.met === null ? 'no data yet' : m.met ? 'met' : 'not met';
}

type SectionProps = { id: string; title: string; definition: string; m: Metric; goal: string; value: string };

function MetricSection({ id, title, definition, m, goal, value }: SectionProps) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="muted">{definition}</p>
      <p>
        {value}: {m.percent === null ? 'no data yet' : `${m.percent}% (${m.numerator} of ${m.denominator})`}. Threshold: {goal}. Result:{' '}
        {verdict(m)}.
      </p>
    </section>
  );
}

export default async function AdminPilotPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const db = getDb();
  const now = new Date();
  const [m, effort, hours, points] = await Promise.all([
    pilotMetrics(db, now),
    operatingEffort(db, now),
    recentHours(db, 8),
    pointsCorrect(db),
  ]);
  return (
    <>
      <h1>Pilot measurement</h1>
      <StatusNote done={done} error={error} />
      <p className="muted">
        Counts only, from the last 21 days of signed-in members ({m.members} verified accounts created in the window). No emails,
        names or ids are shown.
      </p>
      <section aria-labelledby="visitors">
        <h2 id="visitors">Visitors</h2>
        <p>Visitor-level activation: not measured (no visitor identifiers by design).</p>
      </section>
      <MetricSection
        id="activation" title="Activation" m={m.activation} value="Answered an item in the first 7 days" goal={`${m.activation.threshold}% or more`}
        definition="Members with at least one answer within 7 days of signing up, out of all members."
      />
      <MetricSection
        id="return" title="Return" m={m.returning} value="Came back" goal={`${m.returning.threshold}% or more`}
        definition="Of activated members whose first answer is at least 7 days old, those who answered again on a later day within 7 days."
      />
      <MetricSection
        id="interest" title="Interest uptake" m={m.interestUptake} value="Chose interests" goal={`${m.interestUptake.threshold}% or more`}
        definition="Members who picked at least one topic or world interest for themselves."
      />
      <MetricSection
        id="quality" title="Quality" m={m.quality} value="Corrections per 100 items published" goal={`under ${m.quality.threshold} per 100`}
        definition="Unpublishes and text edits of published items in the window, per 100 items published in the window."
      />
      <section aria-labelledby="effort">
        <h2 id="effort">Operating effort</h2>
        <p className="muted">Average of the last 4 logged weeks.</p>
        <p>
          {effort.average === null ? 'No data yet' : `${effort.average} hours a week (${effort.weeks} weeks logged)`}. Threshold: under{' '}
          {effort.threshold} hours a week. Result: {verdict(effort)}.
        </p>
        <h3>Last 8 logged weeks</h3>
        {hours.length === 0 ? (
          <p>No weeks logged yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Week starting (Monday)</th>
                <th scope="col">Hours</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h.weekStart}>
                  <th scope="row">{h.weekStart}</th>
                  <td>{h.hours}</td>
                  <td>{h.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>Log hours</h3>
        <ActionForm csrf={admin.csrf} action="ops.log_hours" returnTo={BACK} label="Log hours">
          <p>
            <label htmlFor="hours-week">A date in the week (it is saved as that week&apos;s Monday)</label>
            <input id="hours-week" name="week_start" type="date" required />
          </p>
          <p>
            <label htmlFor="hours-hours">Hours worked (0 to 80)</label>
            <input id="hours-hours" name="hours" type="number" min="0" max="80" step="0.1" required />
          </p>
          <p>
            <label htmlFor="hours-note">Note (optional, up to 200 characters)</label>
            <input id="hours-note" name="note" maxLength={200} />
          </p>
        </ActionForm>
      </section>
      <section aria-labelledby="circles">
        <h2 id="circles">Circle value (Pilot B)</h2>
        <p>Pilot B is a hand tally by the owner. It is not measured here.</p>
      </section>
      <section aria-labelledby="scoring">
        <h2 id="scoring">Circle scoring</h2>
        <p>
          A correct answer to a circle&apos;s daily set earns {points} points. Nothing is given for speed. A change applies to every
          circle&apos;s scores at once, past days included.
        </p>
        <ActionForm csrf={admin.csrf} action="scoring.set_points" returnTo={BACK} label="Save points">
          <p>
            <label htmlFor="points-correct">Points for a correct answer (0 to 100)</label>
            <input id="points-correct" name="points" type="number" min="0" max="100" step="1" defaultValue={points} required />
          </p>
        </ActionForm>
      </section>
    </>
  );
}
