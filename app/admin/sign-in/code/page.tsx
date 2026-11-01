import { requirePending } from '@/lib/admin/next';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SignInCodePage({ searchParams }: Props) {
  const pending = await requirePending();
  const { error } = await searchParams;
  return (
    <>
      <p className="eyebrow">ADMIN</p>
      <h1>Authenticator code</h1>
      {error === '1' && (
        <div role="alert" className="grown-ups">
          <p>That code was not right. Check the code for SparkKindly in your app and try again.</p>
        </div>
      )}
      <form method="post" action="/admin/sign-in/code/submit/" className="prose admin-form">
        <input type="hidden" name="csrf" value={pending.csrf} />
        <p>
          <label htmlFor="code">Six-digit code for {pending.email}</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
            required
            maxLength={6}
          />
        </p>
        <button type="submit" className="button">
          Sign in
        </button>
      </form>
    </>
  );
}
