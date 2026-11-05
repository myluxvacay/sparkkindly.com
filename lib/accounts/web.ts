// The four account POSTs as plain functions of a Request, so they test without Next. Each checks Origin first.
// Sign-in answers are identical for a known and an unknown address: the response is decided from the form alone, and
// every database read, limit check and email send runs afterwards through `defer` (Next's after()), so neither the
// body nor the timing says whether an account exists. A token is never put in a response body or a log line.
// The parent of a 13-15 account is emailed only after the holder has used their own link (never on sign-up or on a
// link request), once, and never with the parent address or a token in a log line.
import { clientKey, readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { linkBase } from '@/lib/admin/sessions';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { issueConsentTokens } from './consent';
import { consentEmail } from './consent-email';
import { accountLinkLimits, accountSendBudget, confirmLimits, signUpLimits } from './limits';
import { accountStatus, consumeAccountLink, endAccountSession, getAccount, hasFreshLink, requestAccountLink, sessionView } from './sessions';
import { consentPending } from './policy';
import { normalizeEmail, signUp } from './signup';
import { inviteReturnPath } from '@/lib/circles/invites';

export const ACCOUNT_COOKIE = '__Host-sk_account';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export const accountCookie = (value: string, maxAgeSeconds: number): string =>
  `${ACCOUNT_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;

export type Deps = {
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

export const forbidden = () => new Response('Forbidden', { status: 403 });
export const tooMany = () => new Response('Too many attempts. Please try again later.', { status: 429, headers: { 'Retry-After': '3600' } });

// Mints and emails a sign-in link to a known address; does nothing for an unknown one. Runs after the response.
// The per-address allowance is spent only for a real account without a link from the last minute, so unknown
// addresses use (and grow) nothing and a burst for one address mints once. The site-wide budget is checked before the
// mint (a budget-blocked request spends no mint) and applies to sign-up sends and to unverified addresses only, so
// anonymous sign-up traffic can never starve a verified member's sign-in link.
// `next` is an invite page (plan 4B) the person came from, already validated; the link carries it to the confirm step.
async function emailLink(
  d: Deps,
  email: string,
  ip: string,
  links: typeof accountLinkLimits,
  fromSignUp: boolean,
  next: string | null = null,
): Promise<void> {
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
      text: `Use this link within 15 minutes to sign in to SparkKindly:\n\n${linkBase(d.env)}/account/sign-in/link/?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}\n\nIf you did not ask for it, ignore this email.`,
    });
  } catch (err) {
    console.error('account sign-in email not sent:', (err as Error).name);
  }
}

// Emails the parent of a verified, pending account fresh confirm and withdraw links. With `first`, only when the
// account has never been sent any (its first sign-in); later sign-ins send nothing and the account page's resend button
// covers a lost email. The budget is checked before tokens are issued, so a blocked send leaves earlier links working.
export async function emailConsentRequest(d: Deps, accountId: string, first = false): Promise<void> {
  try {
    const due = await d.db.query(
      `SELECT 1 FROM accounts a
       WHERE a.id = $1 AND a.consent_state = 'pending' AND a.verified_at IS NOT NULL AND a.parent_email IS NOT NULL
       ${first ? 'AND NOT EXISTS (SELECT 1 FROM account_consent_tokens t WHERE t.account_id = a.id)' : ''}`,
      [accountId],
    );
    if (due.rows.length === 0 || !(d.budget ?? accountSendBudget)()) return;
    // The earlier confirm link stays valid: if this send fails the parent still has a working one.
    const t = await issueConsentTokens(d.db, accountId, d.now, { revokeOldConfirm: false });
    if (!t) return;
    const base = linkBase(d.env);
    const m = consentEmail('request', {
      confirmUrl: `${base}/account/consent/?token=${t.confirm}`,
      withdrawUrl: `${base}/account/consent/withdraw/?token=${t.withdraw}`,
      privacyUrl: `${base}/privacy/`,
    });
    await d.send({ to: t.parentEmail, ...m });
  } catch (err) {
    // The error name only: a message can carry the parent's address.
    console.error('parent consent email not sent:', (err as Error).name);
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
  const next = inviteReturnPath(form?.get('next'));
  d.defer(() => emailLink(d, email, ip, d.links ?? accountLinkLimits, false, next));
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
      const next = inviteReturnPath(form.get('next'));
      d.defer(() => emailLink(d, email, ip, d.links ?? accountLinkLimits, true, next));
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
    console.error('account link not confirmed:', err.name);
    return null;
  });
  if (!session) return seeOther('/account/sign-in/?expired=1');
  // Switching accounts: the session this browser held so far ends now, not when it would have expired.
  await endAccountSession(d.db, readCookie(request, ACCOUNT_COOKIE));
  d.defer(async () => {
    const account = await getAccount(d.db, session, d.now).catch(() => null);
    if (account && consentPending(account.ageGroup, account.consent)) await emailConsentRequest(d, account.id, true);
  });
  // Back to the invite page the person came from (validated: an invite path only, never another URL).
  return seeOther(inviteReturnPath(form?.get('next')) ?? '/account/', accountCookie(session, SESSION_SECONDS));
}

// Refused in a child context (ruling, 3C Task 3 review): a crafted POST must not drop a child to anonymous.
export async function signOut(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const token = readCookie(request, ACCOUNT_COOKIE);
  if ((await sessionView(d.db, token, d.now))?.profile) return forbidden();
  await endAccountSession(d.db, token);
  return seeOther('/account/sign-in/', accountCookie('', 0));
}
