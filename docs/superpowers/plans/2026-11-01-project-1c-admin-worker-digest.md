# Project 1C: Admin, Worker and Daily Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a signed-in `/admin` (email link for allow-listed addresses plus an authenticator code) to run the content pipeline, a worker that publishes due items every minute, and a daily digest email.

**Architecture:** All rules live in `lib/admin/` and `lib/jobs/` (no Next imports, unit-tested on PGlite). Admin pages are thin server components that call `requireAdmin()` themselves; every admin mutation is a form POST to **one** route, `/admin/act/`, which checks Origin, CSRF token, session, allow-list and second factor before dispatching to a named action that writes its change and its `audit_log` row in one transaction. The worker is `worker/main.ts`, bundled by esbuild into the release as `worker.mjs` and run once a minute by a systemd timer as a oneshot service with `MemoryMax`.

**Tech Stack:** Next.js 16.4.2, React 19, `pg` via `lib/db.ts`, PGlite (unit), Playwright + axe (e2e), `node:crypto` for TOTP/tokens (no new auth dependency), esbuild 0.28.2 (already installed through tsx; pinned as an explicit dev dependency for the worker bundle), MailerSend through the existing `sendEmail`.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` — Project 1 (admin area, admin sign-in, daily digest), section 7 (job reliability, security: email link + authenticator code, audit log, 90-day key rotation from `/admin`), 4a.4 (reports queue), 4a.6 (operating model). Tracker 1.12, 1.13, 1.14.

## Scope and rulings

- **In:** 1.12 sign-in + audit; 1.13 approval queue, items (create article, edit title/summary, unpublish, revisions), problem reports, worlds (create with `RESERVED_WORLD_SLUGS`, enable, approval mode, edit text), topics (create, rename), agents (create, rotate, revoke/enable, key shown once), run history, digest page; 1.14 worker + digest; deferred 1A/1B minors (below).
- **Out (ruling):** agent topic proposals (no agent API for proposing exists; Project 2 adds it with the master agent); body JSON editing (title/summary only; unpublish + agent resubmit covers body fixes); immediate failure alert emails (the digest and the runs page show `failed_jobs`; Better Stack heartbeats are owner task 0.3/0.12); master-agent 36 h heartbeat (2.9); trust pages, a11y sign-off, cut-over (1D, sibling agent).
- **Allow-list:** env `ADMIN_EMAILS` (comma-separated, compared lower-cased). Not added to `requiredEnv`, so health stays green; an empty list means nobody can sign in (fails closed).
- **Second factor enrolment** is a CLI script run by the owner against the database (`npm run admin:totp -- <email>`), never a web page, so mailbox access alone can never enrol a factor.
- **Worker shape:** systemd timer + oneshot service running the *current* release's `worker.mjs`, so a deploy needs no worker restart and `deploy-receive.sh`/sudoers stay unchanged; systemd never overlaps two runs of one unit.
- **Digest:** sent to `ADMIN_EMAILS` once per UTC day at or after `DIGEST_HOUR_UTC` (default 7, after the 06:00 publish slot); claimed in `job_runs` before sending, so a failed send is recorded in `failed_jobs` and not retried every minute.

## Global Constraints

- Server-derived context is authoritative; missing context fails closed (`.claude/rules/data-isolation.md`). "Admin is an allow-list plus a second factor. Admin routes check both on every request."
- Every admin action is in the audit log (spec section 7), written in the same transaction as the change.
- Kids items and items in review-mode worlds never reach `scheduled`/`published` without `approved_by` (database constraint + trigger already enforce it; approval sets it to the admin's email).
- Never log or return a login token, session token, TOTP secret or agent key, except the agent key shown once to the admin who created/rotated it (`cache-control: no-store`).
- Secrets only in env files on the VM; this plan adds env *names* (`ADMIN_EMAILS`, `DIGEST_HOUR_UTC`) to the `.env.example` files, never values.
- Every outbound HTTP call has a bounded timeout (sendEmail already: 10 s); the email link and code flow never wait on MailerSend to answer (no timing oracle).
- WCAG 2.2 AA on admin pages (native forms, labels, `role="status"` confirmations); works without JavaScript.
- Migrations additive (expand-then-contract). Routes thin; one concern per module; Prettier-style formatting.
- Commits carry no AI co-author trailers. No push, deploy or live-server change.

## Review Focus

1. **Second factor bypass:** a session that consumed a link but never passed the code reaching any admin page or action; a code replayed within its 30 s window; unlimited code guessing. Pinned in Tasks 2, 3, 6.
2. **Cross-site and forged requests:** an admin POST with no Origin, a foreign Origin, a missing or wrong CSRF token, or a `return` value like `//evil.example` or `https://evil.example`. Pinned in Tasks 3, 6.
3. **Allow-list revocation and session lifetime:** an address removed from `ADMIN_EMAILS` keeps working; an expired or signed-out session still works; a link used twice. Pinned in Tasks 2, 6.
4. **Tampered ids:** approving an item that is not `in_review`, a non-uuid id, a nonexistent agent id, rotating agent A leaving A's old key valid or breaking agent B's key. Pinned in Tasks 4, 6.
5. **Worker partial failure:** one bad item aborting the whole publish batch; a second runner racing the first; a disabled world's item publishing; the digest sent twice in a day. Pinned in Tasks 1, 5.

## File Structure

| Path | Responsibility |
|---|---|
| `db/migrations/005_admin.sql` | `admin_users`, `admin_login_tokens`, `admin_sessions`, `job_runs` |
| `lib/items/repo.ts` | + `transitionTx`, `updateText` (in-transaction forms) |
| `lib/items/policy.ts` | + `lockWorldSlots` |
| `lib/jobs/publish-due.ts` | batch never aborts; event in the publish transaction; disabled worlds skipped |
| `lib/admin/totp.ts` | RFC 6238 TOTP, base32, otpauth URI |
| `lib/admin/sessions.ts` | allow-list, link tokens, sessions, code check, CSRF token |
| `lib/admin/guard.ts` | strict same-origin, safe return path, client key, sign-in rate limits |
| `lib/admin/actions.ts` | the named admin actions + dispatcher, audit in one transaction |
| `lib/admin/queries.ts` | read models for admin pages |
| `lib/admin/digest.ts` | build, render and send the digest |
| `lib/admin/next.ts` | Next glue: cookie name/options, `currentAdmin`, `requireAdmin` |
| `worker/main.ts` | one tick: publish due, maybe digest |
| `scripts/admin-totp.ts` | enrol an authenticator for an email (prints secret once) |
| `app/admin/**` | thin pages + `sign-in/*` routes + `act/route.ts` |
| `deploy/systemd/sparkkindly-worker{,-staging}.{service,timer}` | worker units |

---

### Task 1: Deferred minors in items, policy and publish-due

**Files:** Modify `lib/items/repo.ts`, `lib/items/policy.ts`, `lib/agents/api.ts`, `lib/jobs/publish-due.ts`. Test `tests/unit/publish-due.test.ts` (extend or create), `tests/unit/policy.test.ts`.

**Interfaces — Produces:**
- `transitionTx(tx: Queryable, id: string, to: Status, by: string, reason?: string, approval?: { by: string }): Promise<StoredItem>`; `transition` becomes `db.transaction(tx => transitionTx(...))`.
- `lockWorldSlots(tx: Queryable, worldId: number): Promise<void>` (`pg_advisory_xact_lock(7263002, worldId)`), called in `submitItem`'s transaction before `nextSlot`, so two concurrent submissions cannot take the same slot.
- `publishDue(db, now): Promise<{ published: string[]; held: string[]; failed: string[] }>`.

- [ ] **Step 1: Failing tests:** `a disabled world's due item stays scheduled`; `the item_published event is written in the same transaction (an event insert failure leaves the item scheduled)` (simulate by a trigger on `events` that raises for one item id); `an item that throws an unexpected error is reported in failed and the rest still publish`; `an item already moved by another runner is skipped without aborting` (in_review→in_review case: item held twice); `two submissions in parallel for one world get different slots`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/publish-due.test.ts tests/unit/policy.test.ts tests/unit/agent-api.test.ts` — new tests FAIL.
- [ ] **Step 3: Implement.** publishDue selects `JOIN worlds w ON w.enabled`; per item, `db.transaction(tx => transitionTx + INSERT events)`; per-item catch: `IllegalTransitionError`/`NotFoundError` skip, `ApprovalRequiredError` → `transition(…'in_review')` inside its own try, anything else → `failed` and `console.error` with the id and message only.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Commit** `fix: publish-due never aborts its batch, skips disabled worlds, writes its event atomically; slots locked per world`.

### Task 2: Admin schema, TOTP and sessions

**Files:** Create `db/migrations/005_admin.sql`, `lib/admin/totp.ts`, `lib/admin/sessions.ts`, `scripts/admin-totp.ts`; modify `package.json` (script `admin:totp`). Test `tests/unit/admin-totp.test.ts`, `tests/unit/admin-sessions.test.ts`, `tests/unit/schema.test.ts` (new describe).

**Interfaces — Produces:**
- Tables: `admin_users(email text PK CHECK (email = lower(email)), totp_secret text NOT NULL, totp_last_step bigint NOT NULL DEFAULT 0, created_at)`; `admin_login_tokens(token_hash text PK, email text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz)`; `admin_sessions(token_hash text PK, email text NOT NULL, stage text NOT NULL CHECK (stage IN ('code','active')), code_failures int NOT NULL DEFAULT 0, created_at, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL)`; `job_runs(job text, run_key text, at timestamptz DEFAULT now(), PRIMARY KEY (job, run_key))`.
- `totp.ts`: `base32Encode(buf: Buffer): string`, `base32Decode(s: string): Buffer`, `newTotpSecret(): string`, `totpAt(secret: string, step: number): string`, `matchTotp(secret: string, code: string, now: Date, lastStep: number): number | null` (window ±1 step, returns matched step only if `> lastStep`), `otpauthUri(email: string, secret: string): string`.
- `sessions.ts`: `allowList(env: EnvLike): string[]`; `isAllowed(email, env): boolean`; `requestLink(db, email: string, env, now): Promise<string | null>` (token only for allow-listed, 15 min); `consumeLink(db, token, env, now): Promise<string | null>` (single use; returns a `code`-stage session token, 10 min); `submitCode(db, sessionToken, code, env, now): Promise<'ok' | 'bad' | 'locked' | 'not_enrolled' | 'none'>` (5 failures delete the session; ok → `active`, 12 h absolute, 60 min idle); `getAdmin(db, sessionToken, env, now): Promise<{ email: string } | null>` (active, unexpired, idle ≤ 60 min, still allow-listed; touches `last_seen_at` at most once a minute); `pendingEmail(db, token, now)`; `endSession(db, token)`; `csrfToken(sessionToken): string` (sha256 of `csrf:` + token); `checkCsrf(sessionToken, given: unknown): boolean` (timing-safe). Only sha256 hashes of tokens are stored.

- [ ] **Step 1: Failing tests.** TOTP: RFC 6238 SHA-1 vector (secret `12345678901234567890`, T=59 → `94287082` truncated to 6 digits `287082`); base32 round trip; previous/next step accepted, two steps away rejected; a step `<= lastStep` rejected (replay); non-digit and 7-digit codes rejected. Sessions: non-allow-listed email gets no token and no row; a link works once (second use null) and not after 15 min; a code-stage session is **not** an admin (`getAdmin` null); a right code makes it active; the same code again on a new session is refused (replay); 5 wrong codes → `locked` and the session row is gone; an email with no `admin_users` row → `not_enrolled`; removing the email from env makes `getAdmin` null; idle 61 min and 12 h + 1 s are null; `endSession` makes it null; no table stores the raw token (search all `admin_*` rows for it); `checkCsrf` false for another session's token, `undefined`, and a wrong length.
- [ ] **Step 2: Run** `npx vitest run tests/unit/admin-totp.test.ts tests/unit/admin-sessions.test.ts tests/unit/schema.test.ts tests/unit/migrate-files.test.ts` — FAIL.
- [ ] **Step 3: Implement** (code-step updates and `totp_last_step` write in one transaction with `SELECT … FOR UPDATE` on `admin_users`). `scripts/admin-totp.ts <email>` upserts `admin_users`, writes `audit_log(actor 'cli', action 'totp_enrolled')`, prints the otpauth URI and secret once, warns when the email is not in the local `ADMIN_EMAILS`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: admin sessions with email link, authenticator code and CSRF token`.

### Task 3: Sign-in routes and pages

**Files:** Create `lib/admin/guard.ts`, `lib/admin/next.ts`, `app/admin/sign-in/page.tsx`, `app/admin/sign-in/request/route.ts`, `app/admin/sign-in/link/page.tsx`, `app/admin/sign-in/link/confirm/route.ts`, `app/admin/sign-in/code/page.tsx`, `app/admin/sign-in/code/submit/route.ts`. Test `tests/unit/admin-guard.test.ts`.

**Interfaces — Produces:**
- `guard.ts`: `sameOrigin(request: Request): boolean` (Origin **required** and its host equals `Host`); `clientKey(request): string` (first `X-Forwarded-For` entry or `unknown`); `safeReturn(raw: unknown): string` (only `/admin/…` paths matching `^/admin/[A-Za-z0-9/_\-?=&.]*$` with no `//` or `\`, else `/admin/`); `createSignInLimits(clock?)` → `(client, email, allowed) => 'new' | 'resend' | 'skip'` (see ruling below); `createCodeLimits(clock?)` → `(client) => boolean` (20/hour per IPv4 /24 or IPv6 /64); `readForm(request, max = 8192): Promise<URLSearchParams | null>`.
- `next.ts`: `ADMIN_COOKIE = '__Host-sk_admin'`; `cookieOptions(maxAgeSeconds)` (`httpOnly`, `secure`, `sameSite: 'strict'`, `path: '/'`); `currentAdmin(): Promise<{ email: string; csrf: string } | null>`; `requireAdmin()` (redirects to `/admin/sign-in/`).
- Flow: `/admin/sign-in/` email form → POST `request/` always 303 to `/admin/sign-in/?sent=1` (rate-limited 429; the email send is not awaited) → email link `/admin/sign-in/link/?token=…` shows a "Continue" button (a GET never consumes the token, so link scanners cannot) → POST `link/confirm/` sets the cookie and 303 to `code/` → POST `code/submit/` with `csrf`, `code` → 303 `/admin/`. Every sign-in route writes an audit row (`sign_in_link_requested` only for allow-listed, `sign_in_link_used`, `sign_in_code_ok`, `sign_in_code_bad`, `sign_in_locked`). All admin pages are `robots: noindex` and `force-dynamic`.

- [ ] **Step 1: Failing tests:** `sameOrigin` true for matching Origin, false for none, `null` string, foreign host, malformed URL; `safeReturn` rejects `//evil.example`, `https://evil.example`, `/admin/\\evil`, `/public/`, non-string; accepts `/admin/items/?status=draft`; the 11th sign-in request from one client and the 4th for one email in an hour are refused while another client/email passes; `readForm` returns null above the cap.
- [ ] **Step 2: Run** `npx vitest run tests/unit/admin-guard.test.ts` — FAIL.
- [ ] **Step 3: Implement** guard, next glue, pages and routes (route bodies: guard checks → lib call → 303).
- [ ] **Step 4: Run** — PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: admin sign-in pages and routes`.

### Task 4: Admin actions with audit

**Files:** Create `lib/admin/actions.ts`, `lib/admin/audit.ts`. Modify `lib/items/repo.ts` (`updateText`). Test `tests/unit/admin-actions.test.ts`.

**Interfaces — Produces:**
- `type AdminActionResult = { ok: true; message: string; secret?: string } | { ok: false; status: 400 | 404 | 409; message: string }`.
- `runAction(db: Db, admin: { email: string }, name: string, form: URLSearchParams, now?: Date): Promise<AdminActionResult>`; unknown name → 400. Actions: `item.approve` (in_review → scheduled, `approved_by` = admin, `publish_at` = later of stored future `publish_at` and `nextSlot` under `lockWorldSlots`), `item.reject`, `item.unpublish` (published|scheduled → archived), `item.edit` (title 1–140, summary 1–300, reason required; revision written), `item.create` (article in a world: title, slug, summary, paragraphs split on blank lines, audience; scheduled `publish_at = now`, `approved_by` = admin, risk tier `kids` in the Kids world or for audience kids, else `reflective`), `report.close`, `world.create` (slug `^[a-z0-9-]{2,30}$`, not in `RESERVED_WORLD_SLUGS`, not existing; disabled until enabled), `world.update` (name/promise/description), `world.enabled`, `world.mode` (Kids constraint violation → 409 message), `topic.create`, `topic.rename`, `agent.create` (secret = key), `agent.rotate` (new prefix + hash; old key dead; secret = key), `agent.enabled`.
- `audit(tx, actor, action, target, detail)`; every action writes exactly one row in its own transaction; `detail` never contains a key, token or hash.

- [ ] **Step 1: Failing tests:** approve a Kids in_review item → scheduled with approver and a future `publish_at` (the held-item fix); approve on a published item → 409 and no audit row; a non-uuid id → 404; reject; unpublish hides the item from `getPublicItem`; edit writes a revision and an audit row; create makes a public article; `world.create` with `admin`, `quiz`, an existing slug and `Bad Slug` → 400; `world.mode` auto on Kids → 409; agent rotate: the old key fails `authenticate`, the new one passes, agent B's key still passes; a disabled agent fails `authenticate`; rotating a nonexistent agent id → 404; no audit row's `detail` contains the key or its hash; every successful action leaves exactly one audit row naming the admin's email.
- [ ] **Step 2: Run** `npx vitest run tests/unit/admin-actions.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: admin actions with audit log`.

### Task 5: Digest and worker

**Files:** Create `lib/admin/digest.ts`, `worker/main.ts`, `deploy/systemd/sparkkindly-worker.service`, `…-worker.timer`, `…-worker-staging.service`, `…-worker-staging.timer`. Modify `deploy/provision/03-services.sh` (install + enable timers), `.github/workflows/deploy.yml` (bundle step), `package.json` (`worker:build`, `esbuild` 0.28.2 exact dev dep), `deploy/env/*.env.example`, `.env.example`. Test `tests/unit/digest.test.ts`, `tests/unit/worker.test.ts`.

**Interfaces — Produces:**
- `type Digest = { day: string; published: {title; world}[]; waiting: {title; world; since: Date}[]; heldByGates: {title; world; reason}[]; failedJobs: {job; error; at}[]; buffer: {world; days: number}[]; openReports: number; alerts: string[] }`.
- `buildDigest(db: Queryable, now: Date): Promise<Digest>` (window = the 24 h before `now`; alerts: enabled world with buffer < 1 day, Kids item waiting > 48 h, any failed job, no agent run in 3 days).
- `renderDigest(d: Digest): { subject: string; text: string }` (plain text; titles are data, no HTML).
- `sendDigestIfDue(db, now, env, send: (m: EmailMessage) => Promise<unknown>): Promise<'sent' | 'not_due' | 'already_sent' | 'no_recipients'>`.
- `tick(db: Db, now: Date, env: EnvLike, send): Promise<void>` in `worker/main.ts` — `runJob('publish-due', …)` then `runJob('digest', …)`; running the file directly calls `tick` once and closes the pool.

- [ ] **Step 1: Failing tests:** digest lists yesterday's published item and not an older one; counts a waiting Kids item and raises the 48 h alert; shows buffer days per enabled world; renderDigest output contains no explanation/answer text and survives a title with `<script>`; `sendDigestIfDue` before the hour → `not_due`, after → `sent` once then `already_sent`, empty `ADMIN_EMAILS` → `no_recipients`; a failing send leaves a `failed_jobs` row via tick and is not resent the same day; `tick` publishes a due item.
- [ ] **Step 2: Run** `npx vitest run tests/unit/digest.test.ts tests/unit/worker.test.ts` — FAIL.
- [ ] **Step 3: Implement**; units: `Type=oneshot`, `ExecStart=/opt/sparkkindly/node/bin/node worker.mjs`, `MemoryMax=256M`, `TimeoutStartSec=300`, same hardening as the web unit; timer `OnBootSec=1min`, `OnUnitActiveSec=1min`, `AccuracySec=5s`. Build: `esbuild worker/main.ts --bundle --platform=node --format=esm --packages=external --outfile=release/worker.mjs` (resolves `@/` from tsconfig; `pg` comes from the standalone `node_modules`).
- [ ] **Step 4: Run** tests — PASS; `npm run worker:build` then `node` the bundle against the e2e database once (prints the tick summary).
- [ ] **Step 5: Commit** `feat: worker publishes due items and sends the daily digest`.

### Task 6: Admin pages, the action route and e2e adversarial matrix

**Files:** Create `lib/admin/queries.ts`, `app/admin/act/route.ts`, `app/admin/page.tsx` (queue + alerts), `app/admin/items/page.tsx`, `app/admin/items/[id]/page.tsx`, `app/admin/items/new/page.tsx`, `app/admin/reports/page.tsx`, `app/admin/worlds/page.tsx`, `app/admin/topics/page.tsx`, `app/admin/agents/page.tsx`, `app/admin/runs/page.tsx`, `app/admin/digest/page.tsx`, `components/admin/*` (nav, action form, status). Modify `playwright.config.ts` (preview env `ADMIN_EMAILS`), `app/robots.ts` (disallow `/admin/`). Test `tests/unit/admin-pages.test.ts` (static: every `app/admin/**/page.tsx` outside `sign-in` calls `requireAdmin`), `tests/e2e/admin-auth.spec.ts`, `tests/e2e/admin-actions.spec.ts`, helper `tests/e2e/helpers/admin.ts`.

**Interfaces:** `/admin/act/` POST: Origin strict → session cookie → `getAdmin` → `checkCsrf` → `runAction` → 303 to `safeReturn(form.return)` with `?done=1` or `?error=<message>`; a `secret` result renders a `no-store` page showing the key once. `sign-out` is the action name `session.end` handled in the route (clears the cookie). Failures: no/foreign Origin 403, no admin 303 to sign-in (or 401 for non-browser), bad CSRF 403, body over 8 KB 413.

- [ ] **Step 1: Failing tests.** E2E auth: full flow (seed token + enrolled secret via helper, open link, Continue, code) reaches `/admin/` and writes `sign_in_code_ok`; every admin page without a cookie redirects to sign-in; a code-stage session cookie on `/admin/` redirects to the code page and on `/admin/act/` is refused; a session for an email not in `ADMIN_EMAILS` is refused; a POST to `/admin/act/` without Origin, with a foreign Origin, without CSRF and with another session's CSRF are 403 and write nothing; the sign-in request answers identically for allowed and unknown addresses and never contains a token; the 11th sign-in request from one client is 429; sign-out ends the session (old cookie refused). E2E actions: approve a Kids fixture from the queue (scheduled with approver); unpublish a published fixture (public page 404s); close a report; create a world with slug `admin` shows the error; rotate an agent shows the key once, the old key gets 401 from `/api/agent/brief/`, another agent's key still 200; `return=//evil.example` lands on `/admin/`; axe has no serious/critical violations on the queue, items, item detail and sign-in pages; the queue approve form is completable by keyboard.
- [ ] **Step 2: Run** `npx vitest run tests/unit/admin-pages.test.ts` and `npm run build` (SITE_RELEASE=false) + `npx playwright test tests/e2e/admin-*.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — PASS; visual check of the queue and item pages at 320 px and desktop.
- [ ] **Step 5: Commit** `feat: admin area pages and the single action route`.

### Task 7: Documentation and full verification

**Files:** Modify `docs/OPERATIONS.md` (section "Admin and worker (Project 1C)": allow-list, enrolment, worker timers, digest hour, manual verification of a real digest send, owner steps), tracker (1.12, 1.13, 1.14 → done for 1C, evidence pointer).

- [ ] **Step 1: Run** `npm run lint && npm run typecheck && npx vitest run`, then `npm run build` with `SITE_RELEASE=false` and `npx playwright test`; record counts.
- [ ] **Step 2: Self-review the whole diff for security issues** (logs, responses, cookies, SQL parameterisation, CSRF on every POST).
- [ ] **Step 3: Commit** `docs: Project 1C operations and tracker`.

---

## Self-Review

**Spec coverage.** Email link for allow-list + authenticator code: Tasks 2, 3. Audit log of every admin action: Tasks 3, 4. Approval queue one-click approve/reject, items edit/unpublish/revisions, problem reports, worlds and topics, agents create/rotate/revoke, run history, digest page: Tasks 4, 6. Worker publishes due items, idempotent with retries and `failed_jobs`: Tasks 1, 5. Daily digest content (published yesterday, waiting, failed and why, buffer days, alerts): Task 5. Rate limits on sign-in links: Task 3. Gaps by ruling: topic proposals, body editing, alert emails, heartbeat (Scope and rulings).

**Type consistency.** `transitionTx`/`lockWorldSlots` (Task 1) are used by Task 4; `getAdmin`/`checkCsrf`/`csrfToken` (Task 2) by Tasks 3, 6; `runAction` (Task 4) by Task 6; `buildDigest`/`renderDigest` (Task 5) by the digest page (Task 6).

**Review Focus coverage.** 1 → Tasks 2, 6; 2 → Tasks 3, 6; 3 → Tasks 2, 6; 4 → Tasks 4, 6; 5 → Tasks 1, 5.

## Rulings made during execution

- **Sign-in link limits (settled 1 November 2026 after three automated review rounds; no further iteration).** Client
  key = full IPv4 address or IPv6 /64; 10 requests an hour per client is the main control and the only thing an
  unknown address spends. An allow-listed address gets at most 3 new links an hour whoever asks (no shared site-wide
  bucket); past that the still-valid pending link is re-sent at most once per 5 minutes. The browser always gets the
  same 303. Residual risk: an attacker can delay, never bypass, a sign-in (links only reach the owner's inbox and the
  code and allow-list still gate access); at most about 18 emails an hour reach one allowed address. Recovery: edit
  `ADMIN_EMAILS` and restart.
- **Code limiter** keys IPv4 by /24 (IPv6 /64); malformed addresses share one `unknown` bucket; each challenge also dies
  after 5 wrong codes from any source.
- **Referrer policy** on admin pages is `same-origin`, not `no-referrer`: `no-referrer` makes browsers send
  `Origin: null` on form posts, which the strict origin check refuses (found by e2e).
- **Key age:** migration 005 also adds `agents.key_rotated_at`, so `/admin/agents/` and the digest flag keys over 90 days.
- **Owner-written articles** publish at once (scheduled then published in one transaction, owner as approver), so the
  done-when "create an item in /admin and see it live" needs no worker tick.
- **Pre-existing:** `tests/unit/item-format-docs.test.ts` fails on a Windows CRLF checkout (its regex expects `
`);
  it passes on Linux CI. Not changed here.
