// The invite page loader and metadata, and the invite and community POSTs (plan 4B), as plain functions of a Request in
// the style of lib/circles/web.ts. With ACCOUNTS_ENABLED or CIRCLES_ENABLED off everything is a 404. Opening an invite
// page only reads (and counts the open); joining is a same-origin POST from a signed-in adult context. The token decides
// the circle: a circle id or slug in the form is never read. An unusable token is one neutral 404. A new link token comes
// back once through a short-lived HttpOnly cookie (the database keeps only its hash); redirects carry outcome codes only.
// Verified by tests/unit/circles-invite-web.test.ts.
import type { Metadata } from 'next';
import { clientKey, readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { linkBase } from '@/lib/admin/sessions';
import { asAdult } from '@/lib/accounts/children-web';
import { uuidOf } from '@/lib/accounts/pin';
import { getContext, requireAdultContext } from '@/lib/accounts/context';
import { circleActionLimits, inviteAcceptLimits, inviteEmailLimits, inviteSendBudget, unsubscribeLimits } from '@/lib/accounts/limits';
import { unsubscribeSecret, unsubscribeToken } from '@/lib/accounts/unsubscribe';
import { ACCOUNT_COOKIE, forbidden, tooMany } from '@/lib/accounts/web';
import { circlesEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { joinCommunity } from './communities';
import { flashCookie } from './invite-flash';
import { addressHash, claimAddressSend, readSuppressToken, suppressAddress, suppressToken } from './invite-guard';
import { inviteEmail } from './invite-email';
import {
  acceptInvite,
  createEmailInvite,
  createLinkInvite,
  inviteReturnPath,
  previewInvite,
  recordOpen,
  revokeInvite,
  type InviteMail,
  type InvitePreview,
} from './invites';
import { scoped, type CircleDeps } from './web';

export type InviteDeps = CircleDeps & { network?: (ip: string) => boolean; send?: (m: InviteMail) => Promise<unknown> };

export { INVITE_COOKIE } from './invite-flash';
export const INVITE_IMAGE = '/circles/invite-image/';
const notFound = () => new Response('Not found', { status: 404 });
const joinPath = (token: string) => `/circles/join/${token}/`;
const toInvites = (slug: string, code: string) => seeOther(`/circles/${slug}/?r=${code}#invites`);
const KIND = { friends: 'friends circle', family: 'family circle', community: 'community' } as const;

export type InvitePage =
  | { status: 'not_found' }
  | { status: 'ok'; preview: InvitePreview; viewer: 'anonymous' | 'child' | 'adult'; next: string };

// What /circles/join/<token>/ shows: the circle's name, kind and member count only. Counts the open (an upper bound).
export async function loadInvitePage(db: Db, session: string, token: string, now: Date): Promise<InvitePage> {
  if (!circlesEnabled()) return { status: 'not_found' };
  const preview = await previewInvite(db, token, now);
  if (!preview) return { status: 'not_found' };
  await recordOpen(db, token);
  const ctx = await getContext(db, session, now);
  const viewer = !ctx ? 'anonymous' : ctx.profile ? 'child' : 'adult';
  return { status: 'ok', preview, viewer, next: joinPath(token) };
}

// Title, description and preview image for chat apps: the circle's name and kind, no person's name or address.
export function inviteMetadata(p: InvitePreview | null): Metadata {
  const title = p ? `Join ${p.circleName} on SparkKindly` : 'Circle invite';
  const description = p
    ? `You are invited to a SparkKindly ${KIND[p.kind]}: play a short daily set of quizzes and games together.`
    : 'A SparkKindly circle invite.';
  return {
    title,
    description,
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [INVITE_IMAGE] },
  };
}

const ACCEPT_CODES = new Set(['name', 'capability', 'community_age', 'has_child_adults_only', 'full', 'account_limit', 'already_member', 'removed']);

// The invite page sends no Referer (Referrer-Policy no-referrer), so a browser posts its join form with `Origin: null`.
// That alone proves nothing; with the browser-set Sec-Fetch-Site: same-origin it is our own page (a cross-site page
// cannot set or forge that header). Anything else must pass the usual strict Origin check.
const fromOwnPage = (r: Request): boolean =>
  sameOrigin(r) || (r.headers.get('origin') === 'null' && r.headers.get('sec-fetch-site') === 'same-origin');

export async function acceptInviteRequest(request: Request, d: InviteDeps, token: string): Promise<Response> {
  if (!circlesEnabled()) return notFound();
  if (!fromOwnPage(request)) return forbidden();
  if (!(d.network ?? inviteAcceptLimits)(clientKey(request))) return tooMany();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) {
    const next = inviteReturnPath(joinPath(token));
    return seeOther(next ? `/account/sign-up/?next=${encodeURIComponent(next)}` : '/account/sign-up/');
  }
  const adult = requireAdultContext(ctx);
  if (!adult) return forbidden();
  const form = (await readForm(request)) ?? new URLSearchParams();
  const r = await acceptInvite(d.db, adult.account.id, token, form.get('your_name'), d.now);
  if (r.status === 'joined') return seeOther(`/circles/${r.slug}/?r=joined#result`);
  return ACCEPT_CODES.has(r.status) ? seeOther(`${joinPath(token)}?r=${r.status}#result`) : notFound();
}

export const createLinkRequest = (request: Request, d: InviteDeps, slug: string) =>
  invitePost(request, d, slug, async (accountId) => {
    const r = await createLinkInvite(d.db, accountId, slug, d.now);
    if (r.status === 'created') return seeOther(`/circles/${slug}/?r=link#invites`, flashCookie(r.token));
    return toInvites(slug, r.status === 'closed' ? 'read-only' : 'invite-no');
  });

export const emailInviteRequest = (request: Request, d: InviteDeps, slug: string) =>
  invitePost(request, d, slug, async (accountId, form) => {
    if (!(d.network ?? inviteEmailLimits)(clientKey(request))) return tooMany();
    const send = d.send ?? (async () => undefined);
    const r = await createEmailInvite(d.db, accountId, slug, form.get('email'), d.now, send);
    return toInvites(slug, r === 'closed' ? 'read-only' : r === 'not_allowed' ? 'invite-no' : `email-${r}`);
  });

export const revokeInviteRequest = (request: Request, d: InviteDeps, slug: string) =>
  invitePost(request, d, slug, async (accountId, form) => {
    const ok = await revokeInvite(d.db, accountId, slug, uuidOf(form.get('invite_id')) ?? '', d.now);
    return toInvites(slug, ok ? 'revoked' : 'revoke-gone');
  });

// The circle-scoped POST of lib/circles/web.ts (flags, Origin, adult context, membership, per-account allowance).
function invitePost(
  request: Request,
  d: InviteDeps,
  slug: string,
  act: (accountId: string, form: URLSearchParams) => Promise<Response>,
): Promise<Response> {
  return scoped(request, { db: d.db, now: d.now, limit: d.limit }, slug, act);
}

export async function joinCommunityRequest(request: Request, d: InviteDeps): Promise<Response> {
  if (!circlesEnabled()) return notFound();
  return asAdult(request, d, async (ctx, form) => {
    if (!(d.limit ?? circleActionLimits)(ctx.account.id)) return tooMany();
    const r = await joinCommunity(d.db, ctx.account.id, form.get('slug') ?? '', form.get('your_name'), d.now);
    if (r.status === 'joined') return seeOther(`/circles/${r.slug}/?r=joined#result`);
    return seeOther(`/circles/communities/?r=${r.status}#result`);
  });
}

// The production sender. Nothing goes out without UNSUBSCRIBE_SECRET (the address hash needs it), to a suppressed
// address, past 3 sends to one address in 7 days site-wide (claimAddressSend), or past the invite send budget. A
// recipient with an account gets the account unsubscribe link; any other address gets "never email me invites again".
export function inviteSender(
  env: EnvLike,
  send: (m: EmailMessage) => Promise<unknown>,
  db: Db,
  budget = inviteSendBudget,
  clock: () => Date = () => new Date(),
) {
  return async (m: InviteMail): Promise<void> => {
    const secret = unsubscribeSecret(env);
    const h = addressHash(secret, m.to);
    if (!h || !(await claimAddressSend(db, h, clock())) || !budget()) return;
    const base = linkBase(env);
    const unsub = m.recipientAccountId ? unsubscribeToken(secret, m.recipientAccountId, 'invites') : null;
    const stop = m.recipientAccountId ? null : suppressToken(secret, h);
    const text = inviteEmail(m, {
      joinUrl: `${base}${joinPath(m.token)}`,
      unsubscribeUrl: unsub ? `${base}/account/unsubscribe/?t=${unsub}` : null,
      stopUrl: stop ? `${base}/circles/stop-invites/?t=${stop}` : null,
    });
    await send({ to: m.to, ...text });
  };
}

type StopDeps = { db: Db; env: EnvLike; limits?: (key: string) => boolean };

// "Never email me invites again": the page's POST, with no sign-in and no Origin check (it only ever adds the address
// the signed token names to the suppression list). The answer is the same for a valid and an invalid token; only
// invalid ones spend the per-network allowance.
export async function stopInvitesRequest(request: Request, d: StopDeps): Promise<Response> {
  const h = readSuppressToken(unsubscribeSecret(d.env), (await readForm(request))?.get('t') ?? '');
  if (!h && !(d.limits ?? unsubscribeLimits)(clientKey(request))) return tooMany();
  if (h) await suppressAddress(d.db, h);
  return seeOther('/circles/stop-invites/?r=done#result');
}
