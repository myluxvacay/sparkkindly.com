# Project 3E: Settings, notification preferences, data export, account deletion and inactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An adult, teen or 16+ account holder can open a settings page (adult context only) to set notification preferences and their time zone, download everything held about the account and its child profiles as a JSON file, delete the account and everything in it, and reset a forgotten PIN after a fresh email sign-in; accounts inactive for 24 months get a notice and are deleted 30 days later.

**Architecture:** `lib/accounts/settings.ts` (preferences, time zone), `lib/accounts/export.ts` (export), `lib/accounts/delete.ts` (already has `deleteAccount`; add the self-service wrapper in `lib/accounts/self-delete.ts`), `lib/accounts/inactivity.ts` (daily job), `lib/accounts/pin-reset.ts`. Routes thin under `app/account/settings/**`. Behind `ACCOUNTS_ENABLED`. Reuses `getContext`/`requireAdultContext`, `runJob` + `job_runs` daily claim, `sendEmail`.

**Tech Stack:** Next.js 16 route handlers, TypeScript, PostgreSQL via PGlite in tests, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 3 (notification preferences, time zone, privacy work: data export and account deletion from the settings page), section 4a.5 (access and deletion, retention: inactive 24 months gets a notice and deletion 30 days later, backups age out within 30 days) and `.claude/rules/data-isolation.md`, `database.md` (deletion must remove every row the data inventory lists; test it).

## Global Constraints

- Settings, export, delete and PIN reset are adult-context only (`requireAdultContext`); a child context gets 403 on POSTs and the playing page on GETs. Scope always from the session (`getContext`); no account or profile id from the request.
- Notification preferences: three booleans on `accounts` (`notify_daily_set`, `notify_weekly_circle`, `notify_invites`), all `false` by default. Only sign-in, consent and (later) invite emails are sent today; nothing in this plan sends the optional emails. Every future non-essential email must carry a one-click unsubscribe: build the token mechanism now (`lib/accounts/unsubscribe.ts`: a signed token of account id and kind, using an existing server secret via `lib/env.ts` conventions, never stored; `POST /account/unsubscribe/` one-click endpoint per RFC 8058 plus a GET page that confirms with a button). Never emails a token in a log.
- Time zone: validated against `Intl.supportedValuesOf('timeZone')` (plus 'UTC'); invalid keeps the old value; editable in settings and defaulted from the browser at sign-up as today.
- Export: one JSON document, `Content-Disposition: attachment`, `Cache-Control: no-store`, produced by POST only (same-origin), containing: account (email, date of birth, time zone, consent state, consent_at, created_at, verified_at, notification prefs; the parent email only masked via `maskEmail`), the holder's interests and answers (item slug and world, correct, answered_at), each child profile (display name, age band, created_at, its interests and answers), never `pin_hash`, tokens, sessions or other accounts' data. Every table in the data inventory (`docs/OPERATIONS.md`, "Personal data held") appears in the export test, which fails if a table is added to the inventory but not to the export.
- Delete: a confirmation page that names what will be deleted and requires typing the account email (case-insensitive) and an adult-context POST; calls `deleteAccount`; ends the session; afterwards there is no row in accounts, account_login_tokens (by email), account_sessions, account_consent_tokens, child_profiles, profile_interests, item_responses. Backups age out within 30 days (document).
- Inactivity: an account is inactive when none of its sessions was seen, and no answer was recorded, in the last 24 months (a verified account with no sessions counts from `verified_at`). At 24 months a notice email goes once (`accounts.inactivity_notice_at`); signing in again clears the notice; the account is deleted 30 days after the notice if still inactive. Daily `job_runs` claim (`inactivity-sweep`) through `runJob`; never touches accounts that are active; deletion goes through `deleteAccount` under the account row lock re-checking inactivity (see `lib/accounts/consent-sweep.ts` `deleteIfStillPending` for the pattern). Emails never log the address.
- PIN reset: allowed only in an adult context whose session was created by an email link within the last 10 minutes (a fresh sign-in), sets a new 4-digit PIN without the old one, clears `pin_failures`, `pin_locked_until`, `pin_lock_count`, and ends no other state. Reuse `setPin` rules. A child context can never reach it.
- Migrations expand-only; rollback in the header. No AI trailers. TDD. WCAG 2.2 AA pages; no new cookies; referrer comes from the account layout.

## Review Focus

- A child context hitting settings, export, delete or PIN reset by direct POST/GET is denied server-side.
- Export of account A never contains B's data or any secret; the export test covers every table in the data inventory.
- Deleting an account leaves nothing behind in any table, including `account_login_tokens` by email.
- The inactivity sweep never deletes an account that signed in or answered within 24 months, and clears the notice on sign-in.
- PIN reset is refused for a session older than 10 minutes and for a child context, and a successful reset does not unlock anything else.

---

### Task 1: Migration 011, settings, export, self-delete, unsubscribe token

**Files:**
- Create: `db/migrations/011_settings.sql`, `lib/accounts/settings.ts`, `lib/accounts/export.ts`, `lib/accounts/self-delete.ts`, `lib/accounts/unsubscribe.ts`
- Test: `tests/unit/account-settings.test.ts`, `tests/unit/account-export.test.ts`, `tests/unit/account-self-delete.test.ts`, `tests/unit/account-unsubscribe.test.ts`

**Interfaces:**
- Migration 011: `ALTER TABLE accounts ADD COLUMN notify_daily_set boolean NOT NULL DEFAULT false, ADD COLUMN notify_weekly_circle boolean NOT NULL DEFAULT false, ADD COLUMN notify_invites boolean NOT NULL DEFAULT false, ADD COLUMN inactivity_notice_at timestamptz;` Rollback in the header.
- `getSettings(db, accountId): Promise<{ timeZone: string; notify: { dailySet: boolean; weeklyCircle: boolean; invites: boolean } } | null>`; `saveSettings(db, accountId, input: { timeZone?: unknown; notify?: unknown }): Promise<'ok' | 'invalid'>` (booleans only; unknown keys rejected).
- `exportAccount(db, accountId, now: Date): Promise<AccountExport | null>` per the Global Constraints, plus `EXPORTED_TABLES: readonly string[]` listing every personal-data table it covers (the test compares it with the inventory).
- `deleteOwnAccount(db, accountId, typedEmail: unknown): Promise<'deleted' | 'mismatch' | 'not_found'>` (compares to the stored email, case-insensitive; delegates to `deleteAccount`).
- `unsubscribeToken(secret: string, accountId: string, kind: 'daily_set' | 'weekly_circle' | 'invites'): string` and `readUnsubscribeToken(secret, token): { accountId; kind } | null` (HMAC-SHA256, constant-time compare, no expiry but kind-bound); `applyUnsubscribe(db, accountId, kind): Promise<boolean>` sets that preference false.

- [ ] **Step 1: Failing tests:** save/get round trip and defaults; invalid time zone keeps the old one; non-boolean or unknown key `invalid`; export contains each section for an adult with two child profiles (interests, answers, consent fields), masks the parent email, never contains `pin_hash`/tokens/sessions, and never another account's rows; export test fails when `EXPORTED_TABLES` misses a table named in the OPERATIONS inventory (parse the inventory table names from the doc or maintain a constant checked against `information_schema` for personal-data tables); `deleteOwnAccount` mismatch deletes nothing, match leaves zero rows in all seven tables; tampered/foreign tokens rejected; token for kind A cannot unsubscribe kind B.
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/account-settings.test.ts tests/unit/account-export.test.ts tests/unit/account-self-delete.test.ts tests/unit/account-unsubscribe.test.ts`
- [ ] **Step 3: Implement** (no Next imports in `lib/`).
- [ ] **Step 4: Run** the same plus `tests/unit/migrate*.test.ts` and the full unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: account settings, export, self-service deletion and unsubscribe tokens`.

---

### Task 2: PIN reset after a fresh sign-in, and the inactivity job

**Files:**
- Create: `lib/accounts/pin-reset.ts`, `lib/accounts/inactivity.ts`
- Modify: `worker/main.ts` (daily claim + `runJob`, bundle-safe: `tests/unit/worker-bundle.test.ts` must pass), `lib/accounts/sessions.ts` (clear `inactivity_notice_at` when a session is created)
- Test: `tests/unit/account-pin-reset.test.ts`, `tests/unit/account-inactivity.test.ts`

**Interfaces:**
- `resetPin(db, sessionToken: string, newPin: unknown, now: Date): Promise<'ok' | 'invalid' | 'stale' | 'not_allowed'>`: adult context only, session `created_at` within 10 minutes, valid PIN; clears the lock fields.
- `claimInactivitySweep(db, now): Promise<boolean>`; `runInactivitySweep(db, now, send, links): Promise<{ noticed: number; deleted: number }>` per the Global Constraints, with `inactivityEmail(deletionDate: Date, signInUrl: string): { subject: string; text: string }` (plain text, says what happens and how to keep the account: sign in).

- [ ] **Step 1: Failing tests:** reset ok at 9 minutes, `stale` at 11, `not_allowed` in a child context, invalid PIN `invalid`, reset clears a lock and lock count; inactivity: active account untouched, 24-month-inactive account gets exactly one notice, a sign-in or an answer clears or prevents it, deletion only at 30 days after the notice and rechecks under lock (account active again after listing is spared), verified-without-sessions counts from `verified_at`, the worker runs the sweep once per UTC day, send failure leaves it retryable and logs no address.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the targeted tests plus `tests/unit/worker-bundle.test.ts` and the full unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: PIN reset after a fresh sign-in and the 24-month inactivity job`.

---

### Task 3: Settings pages and routes

**Files:**
- Create: `lib/accounts/settings-web.ts`, `app/account/settings/page.tsx`, `app/account/settings/save/route.ts`, `app/account/settings/export/route.ts`, `app/account/settings/delete/page.tsx`, `app/account/settings/delete/confirm/route.ts`, `app/account/settings/pin/route.ts`, `app/account/unsubscribe/route.ts`, `app/account/unsubscribe/page.tsx`
- Modify: `app/account/page.tsx` (link to settings in the adult view only)
- Test: `tests/unit/account-settings-web.test.ts`, extend `tests/e2e/accounts.spec.ts`

- [ ] **Step 1: Failing unit tests:** every POST same-origin only, flag off 404, anonymous to sign-in, a child context 403 on save/export/delete/pin (and the playing page on GETs); form-supplied account or profile ids ignored; export response headers (`attachment`, `no-store`) and body valid JSON for the signed-in adult only; delete requires the typed email, redirects to the sign-in page with a neutral code and clears the account cookie; PIN reset via a stale session is refused with a neutral message telling the adult to sign in again by email link; unsubscribe POST with a valid token flips only that preference, an invalid token changes nothing and answers identically (no account enumeration), the GET page never changes anything.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** thin routes; settings page: notification checkboxes (fieldset/legend), time zone select (native `<select>` of supported zones), download button, delete link, PIN reset form (new PIN twice, `autocomplete="new-password"`, `inputmode="numeric"`); results via `?r=<code>#result` with focus like the other pages.
- [ ] **Step 4: E2E:** an adult changes preferences and time zone and sees them persist; downloads the export (check JSON keys, no secrets); deletes the account with the typed email and cannot sign in again; a child profile context reaches none of the routes; axe at 320px and desktop; no third-party requests. After `npm run build` run `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts --workers=1` then `git checkout docs/screenshots`.
- [ ] **Step 5: Commit** `feat: settings, export, deletion and PIN reset pages`.

---

### Task 4: Isolation tests, docs and tracker

- [ ] **Step 1:** Add to `account-isolation.test.ts`: account A's export has no B data; child context denied settings/export/delete/PIN reset; deleting an account removes all seven tables; inactivity sweep spares active accounts.
- [ ] **Step 2:** `docs/OPERATIONS.md`: settings, export format and what it excludes, self-service deletion and the 30-day backup ageing, the inactivity job (24 months, 30 days, email, clearing on sign-in), the PIN reset rule (fresh sign-in within 10 minutes), the unsubscribe mechanism and its secret, data-inventory rows for the new columns (notification prefs, `inactivity_notice_at`), migration 011 rollback pointer, privacy-copy gate. Update the "forgotten PIN" text written in 3C (now resolvable). Tracker 3.7/3.8.
- [ ] **Step 3: Run** the full unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files.
- [ ] **Step 4: Commit** `docs: settings, export, deletion and inactivity operations and isolation rows`.
