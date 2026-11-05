// "Report this circle" (plan 4D): a reason and an optional note, posted to /circles/<slug>/report/. Shown to adult-context
// members only (the circle page never renders for a child context).
const REASONS = [
  ['name', 'Its name or description'],
  ['behaviour', 'Someone’s behaviour'],
  ['safety', 'A safety worry'],
  ['other', 'Something else'],
] as const;

export function ReportForm({ slug }: { slug: string }) {
  return (
    <details>
      <summary>Report this circle</summary>
      <form method="post" action={`/circles/${slug}/report/`} className="admin-form">
        <p>Reports go to the SparkKindly team, not to the circle. Please do not include anyone’s contact details.</p>
        <fieldset>
          <legend>What is wrong?</legend>
          {REASONS.map(([value, label]) => (
            <label key={value} className="admin-radio">
              <input type="radio" name="reason" value={value} required /> {label}
            </label>
          ))}
        </fieldset>
        <label htmlFor="report-note">Anything we should know (optional, up to 300 characters)</label>
        <textarea id="report-note" name="note" maxLength={300} rows={3} />
        <button type="submit" className="button">
          Send report
        </button>
      </form>
    </details>
  );
}
