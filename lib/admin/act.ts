import type { Db } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { runAction } from './actions';
import { audit } from './audit';
import { readCookie, readForm, safeReturn, sameOrigin, seeOther, sessionCookie } from './guard';
import { checkCsrf, endSession, getAdmin } from './sessions';

// The one route every admin change goes through (POST /admin/act/). In order: same Origin, a bounded form body, an
// admin session (link + code, unexpired, address still allow-listed), the session's CSRF token, then the named action.
// Nothing from the form decides who the admin is.

type Deps = { db: Db; env: EnvLike; now: Date };

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
    await endSession(d.db, token);
    await audit(d.db, admin.email, 'session.end', null);
    return seeOther('/admin/sign-in/', sessionCookie('', 0));
  }
  const result = await runAction(d.db, admin, name, form, d.now);
  if (result.ok && result.secret) return secretPage(result.message, result.secret, back);
  const sep = back.includes('?') ? '&' : '?';
  const note = result.ok ? `done=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent(result.message)}`;
  return seeOther(`${back}${sep}${note}`);
}

// A new agent key is shown on this page only, once: never in a URL, a log or the database.
function secretPage(message: string, key: string, back: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Agent key | SparkKindly admin</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#302438}code{display:block;word-break:break-all;padding:1rem;background:#f3ecf5;border-radius:4px}a{color:#5b2c6f}</style></head>
<body><main><h1>Agent key</h1><p role="status">${esc(message)}</p>
<p>Key (send it as the X-Agent-Key header):</p><code>${esc(key)}</code>
<p>It is not stored anywhere readable. If it is lost, rotate the key again.</p>
<p><a href="${esc(back)}">Back to the admin area</a></p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
