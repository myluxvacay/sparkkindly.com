import { randomBytes } from 'node:crypto';
import type { Db } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { runAction } from './actions';
import { audit } from './audit';
import { readCookie, readForm, safeReturn, sameOrigin, seeOther, sessionCookie } from './guard';
import { ERRORS } from './messages';
import { checkCsrf, csrfToken, endSession, getAdmin } from './sessions';

// The one route every admin change goes through (POST /admin/act/). In order: same Origin, a bounded form body, an
// admin session (link + code, unexpired, address still allow-listed), the session's CSRF token, then the named action.
// Nothing from the form decides who the admin is. The redirect carries only a message code (lib/admin/messages.ts).

type Deps = { db: Db; env: EnvLike; now: Date };

const KEY_TTL_MS = 5 * 60_000;

// A new agent key waits here for the GET that shows it: once, to the same admin session, within five minutes. It never
// goes into a URL, a log or the database, and a reload of the key page shows nothing (and rotates nothing).
// ponytail: process memory, so a restart before the key page loads loses the key (rotate again). Fine for one process.
type Pending = { key: string; session: string; back: string; message: string; expires: number };
const shared = globalThis as unknown as { __sparkAgentKeyHandoff?: Map<string, Pending> };
const handoff = (shared.__sparkAgentKeyHandoff ??= new Map<string, Pending>());

export async function handleAdminAction(request: Request, d: Deps): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const form = await readForm(request);
  if (!form) return new Response('Payload too large or not a form', { status: 413 });
  const token = readCookie(request);
  const admin = await getAdmin(d.db, token, d.env, d.now);
  if (!admin) return seeOther('/admin/sign-in/');
  if (!checkCsrf(token, form.get('csrf'))) return new Response('Forbidden', { status: 403 });

  const name = form.get('action') ?? '';
  const back = safeReturn(form.get('return'));
  if (name === 'session.end') {
    await d.db.transaction(async (tx) => {
      await endSession(tx, token);
      await audit(tx, admin.email, 'session.end', null);
    });
    return seeOther('/admin/sign-in/', sessionCookie('', 0));
  }
  const result = await runAction(d.db, admin, name, form, d.now);
  if (result.ok && result.secret) {
    for (const [ref, p] of handoff) if (p.expires <= d.now.getTime()) handoff.delete(ref);
    const ref = randomBytes(16).toString('hex');
    handoff.set(ref, { key: result.secret, session: csrfToken(token), back, message: result.message, expires: d.now.getTime() + KEY_TTL_MS });
    return seeOther(`/admin/act/key/?ref=${ref}`);
  }
  const sep = back.includes('?') ? '&' : '?';
  return seeOther(`${back}${sep}${result.ok ? 'done' : 'error'}=${result.code}`);
}

// GET /admin/act/key/?ref=: shows a handed-over key once, to the session that created it.
export async function showAgentKey(request: Request, d: Deps): Promise<Response> {
  const token = readCookie(request);
  const admin = await getAdmin(d.db, token, d.env, d.now);
  if (!admin) return seeOther('/admin/sign-in/');
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  const p = handoff.get(ref);
  if (!p || p.session !== csrfToken(token) || p.expires <= d.now.getTime()) {
    if (p && p.expires <= d.now.getTime()) handoff.delete(ref);
    return page(410, ERRORS.key_gone, null, '/admin/agents/');
  }
  handoff.delete(ref);
  return page(200, p.message, p.key, p.back);
}

function page(status: number, message: string, key: string | null, back: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = key
    ? `<p>Key (send it as the X-Agent-Key header):</p><code>${esc(key)}</code>
<p>It is not stored anywhere readable and this page will not show it again. If it is lost, rotate the key again.</p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Agent key | SparkKindly admin</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#302438}code{display:block;word-break:break-all;padding:1rem;background:#f3ecf5;border-radius:4px}a{color:#5b2c6f}</style></head>
<body><main><h1>Agent key</h1><p role="status">${esc(message)}</p>${body}
<p><a href="${esc(back)}">Back to the admin area</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
