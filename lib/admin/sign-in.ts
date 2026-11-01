import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { audit } from './audit';
import { clientKey, codeLimits, readCookie, readForm, sameOrigin, seeOther, sessionCookie, signInLimits } from './guard';
import { checkCsrf, consumeLink, isAllowed, linkStillValid, pendingEmail, requestLink, submitCode } from './sessions';

// The three sign-in POSTs, as plain functions of a Request so they test without Next. Each checks Origin first.
// None of them ever puts a token in a response body, a log line or an audit row.

type Deps = { db: Db; env: EnvLike; now: Date; send: (m: EmailMessage) => Promise<unknown>; limits?: typeof signInLimits; codes?: typeof codeLimits; pending?: Map<string, string> };

const forbidden = () => new Response('Forbidden', { status: 403 });
const tooMany = () => new Response('Too many attempts. Please try again later.', { status: 429, headers: { 'Retry-After': '3600' } });
const SIGN_IN = '/admin/sign-in/';

// Where links point: ADMIN_LINK_BASE (staging sets its own), else the production site. Never the request's Host,
// so a forged Host header cannot make the email carry a token to another site.
const linkBase = (env: EnvLike) => (env.ADMIN_LINK_BASE || 'https://sparkkindly.com').replace(/\/+$/, '');

export async function requestSignIn(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const form = await readForm(request);
  const email = form?.get('email')?.trim().toLowerCase() ?? '';
  const done = seeOther(`${SIGN_IN}?sent=1`);
  if (!form || email.length > 254) return done;
  // Every outcome below gets the same answer; only what is sent differs (see createSignInLimits for the ruling).
  const decision = (d.limits ?? signInLimits)(clientKey(request), email, isAllowed(email, d.env));
  const pending = d.pending ?? pendingLinks;
  let token: string | null = null;
  if (decision === 'new') {
    token = await requestLink(d.db, email, d.env, d.now);
    if (token) pending.set(email, token);
  } else if (decision === 'resend') {
    const last = pending.get(email);
    if (last && (await linkStillValid(d.db, last, d.now))) token = last;
  }
  if (token) {
    await audit(d.db, email, decision === 'new' ? 'sign_in_link_requested' : 'sign_in_link_resent', null);
    const link = `${linkBase(d.env)}/admin/sign-in/link/?token=${token}`;
    // Not awaited: the answer is the same, and as fast, whether or not the address is allowed or MailerSend is slow.
    d.send({
      to: email,
      subject: 'Your SparkKindly admin sign-in link',
      text: `Use this link within 15 minutes to sign in to the SparkKindly admin area:\n\n${link}\n\nIf you did not ask for it, ignore this email.`,
    }).catch((err) => console.error('admin sign-in email not sent:', (err as Error).message));
  }
  return done;
}

// The newest link minted per allowed address, kept in this process only, so it can be re-sent (never shown). A
// restart forgets it; the next request then waits for the hourly allowance like any other.
const shared = globalThis as unknown as { __sparkPendingLinks?: Map<string, string> };
const pendingLinks = (shared.__sparkPendingLinks ??= new Map<string, string>());

export async function confirmLink(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  if (!(d.codes ?? codeLimits)(clientKey(request))) return tooMany();
  const form = await readForm(request);
  const session = await consumeLink(d.db, form?.get('token') ?? '', d.env, d.now);
  if (!session) return seeOther(`${SIGN_IN}?expired=1`);
  const email = await pendingEmail(d.db, session, d.now);
  await audit(d.db, email ?? 'unknown', 'sign_in_link_used', null);
  return seeOther('/admin/sign-in/code/', sessionCookie(session, 10 * 60));
}

export async function submitSignInCode(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  if (!(d.codes ?? codeLimits)(clientKey(request))) return tooMany();
  const session = readCookie(request);
  const form = await readForm(request);
  if (!form || !checkCsrf(session, form.get('csrf'))) return forbidden();
  const email = (await pendingEmail(d.db, session, d.now)) ?? 'unknown';
  const result = await submitCode(d.db, session, form.get('code')?.trim() ?? '', d.env, d.now);
  if (result === 'ok') {
    await audit(d.db, email, 'sign_in_code_ok', null);
    return seeOther('/admin/', sessionCookie(session, 12 * 60 * 60));
  }
  if (result === 'bad') {
    await audit(d.db, email, 'sign_in_code_bad', null);
    return seeOther('/admin/sign-in/code/?error=1');
  }
  if (result === 'locked') await audit(d.db, email, 'sign_in_locked', null);
  const next = result === 'not_enrolled' ? `${SIGN_IN}?enrol=1` : `${SIGN_IN}?expired=1`;
  return seeOther(next, sessionCookie('', 0));
}
