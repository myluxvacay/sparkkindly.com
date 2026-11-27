import { requireHubAdult } from '@/lib/family-hub/next';

export const dynamic = 'force-dynamic';

const RESULTS: Record<string, string> = {
  invalid: 'Please give the circle a name (up to 60 characters).',
};

export default async function NewCirclePage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  await requireHubAdult();
  const { r } = await searchParams;
  return (
    <>
      <h1>Create your family circle</h1>
      <p>
        A circle is your household&rsquo;s private space: the adults you invite share one schedule and one runs board. Children are
        added as profiles by a parent — they never get accounts or logins.
      </p>
      {r && RESULTS[r] && (
        <p id="result" role="alert">
          {RESULTS[r]}
        </p>
      )}
      <form method="post" action="/family/create/">
        <p>
          <label>
            Circle name (usually your family name)
            <br />
            <input name="name" required maxLength={60} placeholder="The Manansala Family" />
          </label>
        </p>
        <p>
          <label>
            Time zone (IANA name, e.g. America/New_York)
            <br />
            <input name="time_zone" defaultValue="America/New_York" maxLength={64} />
          </label>
        </p>
        <button type="submit">Create circle</button>
      </form>
    </>
  );
}
