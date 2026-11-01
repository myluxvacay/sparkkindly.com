export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ token?: string }> };

// Opening the emailed link only shows this button: the token is used by the POST, so a mail scanner that fetches the
// link cannot use it up or sign in.
export default async function SignInLinkPage({ searchParams }: Props) {
  const { token } = await searchParams;
  const valid = typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
  return (
    <>
      <p className="eyebrow">ADMIN</p>
      <h1>Continue signing in</h1>
      {valid ? (
        <form method="post" action="/admin/sign-in/link/confirm/" className="prose admin-form">
          <input type="hidden" name="token" value={token} />
          <p>Next you will be asked for the code from your authenticator app.</p>
          <button type="submit" className="button">
            Continue
          </button>
        </form>
      ) : (
        <p role="alert">This link is not valid. Ask for a new one from the sign-in page.</p>
      )}
    </>
  );
}
