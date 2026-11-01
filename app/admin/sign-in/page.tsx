export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ sent?: string; expired?: string; enrol?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { sent, expired, enrol } = await searchParams;
  return (
    <>
      <p className="eyebrow">ADMIN</p>
      <h1>Sign in</h1>
      {sent === '1' && (
        <div role="status" className="takeaway">
          <p>If that address may sign in, a link is on its way. It works once, for 15 minutes.</p>
        </div>
      )}
      {expired === '1' && (
        <div role="alert" className="grown-ups">
          <p>That link or session has expired or was already used. Ask for a new link.</p>
        </div>
      )}
      {enrol === '1' && (
        <div role="alert" className="grown-ups">
          <p>No authenticator is set up for this address yet. It is enrolled from the server (see the operations guide).</p>
        </div>
      )}
      <form method="post" action="/admin/sign-in/request/" className="prose admin-form">
        <p>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
        </p>
        <button type="submit" className="button">
          Email me a sign-in link
        </button>
      </form>
    </>
  );
}
