// A calendar day in UTC, e.g. "17 October 2026" in en. An unparseable value gives '' rather than throwing, because
// stored source dates are untrusted text.
const day = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : d;
  return Number.isNaN(date.getTime()) ? '' : day.format(date);
}
