// The four account POSTs as plain functions of a Request, so they test without Next. Each checks Origin first.
// Sign-in answers are identical for a known and an unknown address: the response is decided from the form alone, and
// every database read, limit check and email send runs afterwards through `defer` (Next's after()), so neither the
// body nor the timing says whether an account exists. A token is never put in a response body or a log line.
// Parent consent for 13-15 sign-ups is a later plan: nothing is emailed to the parent here.
import { clientKey, readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { linkBase } from '@/lib/admin/sessions';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { accountLinkLimits, accountSendBudget, confirmLimits, signUpLimits } from './limits';
import { accountStatus, consumeAccountLink, endAccountSession, hasFreshLink, requestAccountLink } from './sessions';
import { normalizeEmail, signUp } from './signup';

export const ACCOUNT_COOKIE = '__Host-sk_account';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export const accountCookie = (value: string, maxAgeSeconds: number): string =>
  `${ACCOUNT_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;

type Deps = {
  db: Db;
  env: EnvLike;
  now: Date;
  send: (m: EmailMessage) => Promise<unknown>;
  defer: (work: () => Promise<void>) => void;
  signUps?: typeof signUpLimits;
  links?: typeof accountLinkLimits;
  confirms?: typeof confirmLimits;
  budget?: () => boolean;
};

const forbidden = () => new Response('Forbidden', { status: 403 });
const tooMany = () => new Response('Too many attempts. Please try again later.', { status: 429, headers: { 'Retry-After': '3600' } });

// Mints and emails a sign-in link to a known address; does nothing for an unknown one. Runs after the response.
// The per-address allowance is spent only for a real account without a link from the last minute, so unknown
// addresses use (and grow) nothing and a burst for one address mints once. The site-wide budget is checked before the
// mint (a budget-blocked request spends no mint) and applies to sign-up sends and to unverified addresses only, so
// anonymous sign-up traffic can never starve a verified member's sign-in link.
async function emailLink(d: Deps, email: string, ip: string, links: typeof accountLinkLimits, fromSignUp: boolean): Promise<void> {
  try {
    if (!links.client(ip)) return;
    const status = await accountStatus(d.db, email);
    if (!status || (await hasFreshLink(d.db, email, d.now))) return;
    if ((fromSignUp || status === 'unverified') && !(d.budget ?? accountSendBudget)()) return;
    if (!links.mint(email)) return;
    const token = await requestAccountLink(d.db, email, d.env, d.now);
    if (!token) return;
    await d.send({
      to: email,
      subject: 'Your SparkKindly sign-in link',
      text: `Use this link within 15 minutes to sign in to SparkKindly:\n\n${linkBase(d.env)}/account/sign-in/link/?token=${token}\n\nIf you did not ask for it, ignore this email.`,
    });
  } catch (err) {
    console.error('account sign-in email not sent:', (err as Error).message);
  }
}

export async function requestAccountSignIn(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const form = await readForm(request);
  // The same ASCII-only rule as sign-up, on the raw value, so a lookalike (Kelvin sign) never lower-cases into a
  // real address. Anything else gets the same answer and nothing runs.
  const email = normalizeEmail(form?.get('email'));
  const done = seeOther('/account/sign-in/?sent=1');
  if (!email) return done;
  const ip = clientKey(request);
  d.defer(() => emailLink(d, email, ip, d.links ?? accountLinkLimits, false));
  return done;
}

export async function submitSignUp(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const form = await readForm(request);
  if (!form) return seeOther('/account/sign-up/?invalid=1');
  const ip = clientKey(request);
  if (!(d.signUps ?? signUpLimits).signUp(ip)) return tooMany();
  // Raw values: signUp validates (ASCII only) before it lower-cases.
  const result = await signUp(
    d.db,
    { email: form.get('email'), dateOfBirth: form.get('dob'), parentEmail: form.get('parent_email'), timeZone: form.get('time_zone') },
    d.now,
  );
  switch (result.status) {
    // Neutral codes (a: under 13, b: parent email needed), so URLs and access logs do not record an age declaration.
    case 'under_13':
      return seeOther('/account/sign-up/?r=a');
    case 'parent_required':
      return seeOther('/account/sign-up/?r=b');
    case 'invalid':
      return seeOther('/account/sign-up/?invalid=1');
    default: {
      // created and exists look the same, and both send a sign-in link (signUp accepted the address, so it normalizes)
      const email = normalizeEmail(form.get('email'))!;
      d.defer(() => emailLink(d, email, ip, d.links ?? accountLinkLimits, true));
      return seeOther('/account/sign-up/?sent=1');
    }
  }
}

export async function confirmAccountLink(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  if (!(d.confirms ?? confirmLimits)(clientKey(request))) return tooMany();
  const form = await readForm(request);
  // A database error (e.g. the row lock waited past statement_timeout) gets the generic invalid-link page, not a 500.
  const session = await consumeAccountLink(d.db, form?.get('token') ?? '', d.now).catch((err: Error) => {
    console.error('account link not confirmed:', err.message);
    return null;
  });
  if (!session) return seeOther('/account/sign-in/?expired=1');
  // Switching accounts: the session this browser held so far ends now, not when it would have expired.
  await endAccountSession(d.db, readCookie(request, ACCOUNT_COOKIE));
  return seeOther('/account/', accountCookie(session, SESSION_SECONDS));
}

export async function signOut(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  await endAccountSession(d.db, readCookie(request, ACCOUNT_COOKIE));
  return seeOther('/account/sign-in/', accountCookie('', 0));
}
