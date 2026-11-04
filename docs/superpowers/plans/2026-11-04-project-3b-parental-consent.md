# Project 3B: Parental consent for 13 to 15 accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 13 to 15 account starts consent-pending; once its holder has confirmed their own email, the parent gets one email explaining what is collected, with a confirm link and a withdraw link; confirming records consent, withdrawing deletes the account and everything held; unconfirmed accounts get a reminder at 7 days and are deleted at 30.

**Architecture:** One new module `lib/accounts/consent.ts` (tokens, confirm, withdraw, request) plus `lib/accounts/consent-sweep.ts` (reminder, 30-day deletion, parent email cleared at 16) and `lib/accounts/delete.ts` (the one account-deletion function, reused by 3E). Routes stay thin under `app/account/consent/`. Everything stays behind `ACCOUNTS_ENABLED`. Reuses `lib/tokens.ts`, `Db.transaction`, `runJob`, the `job_runs` daily claim, `sendEmail`.

**Tech Stack:** Next.js 16 route handlers, TypeScript, `pg`/PGlite, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` section 4a.5 (teens aged 13 to 15 row; retention rows) and `.claude/rules/data-isolation.md`.

## Global Constraints

- Consent state lives in `accounts.consent_state` ('none' | 'pending' | 'confirmed'); the policy table in `lib/accounts/policy.ts` is unchanged and stays the only place permissions are decided.
- No consent email before `verified_at` is set. A pending account does only what `can()` allows (anonymous plus interests).
- Consent and withdraw tokens: random 32 bytes via `lib/tokens.ts`, stored only as sha256, bound to the account id AND the exact parent email they were sent to; a token whose bound email no longer equals `accounts.parent_email` is invalid.
- Confirm and withdraw are same-origin POSTs behind a GET page that shows what is collected (a mail scanner opening a link must not confirm or delete).
- The confirm link lasts 30 days; a withdraw token has no expiry until the parent email is cleared, the account is deleted, or the account turns 16.
- Withdrawal deletes the account row (cascades sessions and consent tokens) AND `account_login_tokens` for its email, in one transaction.
- Reminder at 7 days after `verified_at`, once; deletion at 30 days after `verified_at` while still pending. At 16 the parent email and all consent tokens are cleared (the consent record `consent_at` stays).
- Parent email is personal data of a third party: never logged, never in URLs, never in a response body (mask it as in `lib/accounts/` link page helper).
- Migrations expand-only; rollback in the header.
- New emails go through `accountSendBudget`; one confirm email per account verification, one reminder, one user-requested resend per hour.
- Commits: no AI trailers. TDD: failing test first. Existing accounts e2e/privacy/axe tests must stay green.

## Review Focus

- A confirm token from account A used against account B, or after the parent email changed: rejected.
- A mail scanner GET on the confirm or withdraw link changes nothing.
- A withdrawn account leaves no row in `accounts`, `account_sessions`, `account_consent_tokens`, `account_login_tokens` (by email).
- A verified, consent-confirmed 13 to 15 account is never touched by the 30-day deletion; a `none` (16+) account is never touched by anything here.
- The consent email is not sent when the first link is merely requested; only after the link is consumed.

---

### Task 1: Consent core (migration 008, tokens, request, confirm, withdraw, delete)

**Files:**
- Create: `db/migrations/008_parental_consent.sql`, `lib/accounts/consent.ts`, `lib/accounts/delete.ts`
- Test: `tests/unit/account-consent.test.ts`

**Interfaces:**
- Migration 008 (expand only): `ALTER TABLE accounts ADD COLUMN consent_at timestamptz, ADD COLUMN consent_reminded_at timestamptz;` and `CREATE TABLE account_consent_tokens (token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, parent_email text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('confirm','withdraw')), expires_at timestamptz, used_at timestamptz)` plus an index on `account_id`. Header states rollback (drop the table, drop the two columns, delete the schema_migrations row).
- `deleteAccount(db: Db, accountId: string): Promise<boolean>` in `lib/accounts/delete.ts`: one transaction deleting `account_login_tokens WHERE email = <account email>` then the account row (cascades the rest); false if no such account.
- `issueConsentTokens(db: Db, accountId: string, now: Date): Promise<{ confirm: string; withdraw: string; parentEmail: string } | null>`: null unless the account is verified, `consent_state = 'pending'` and has a parent email. Deletes the account's unused confirm tokens, inserts a new confirm token (expires now + 30 days) and a new withdraw token (no expiry).
- `consentTarget(db, token, purpose, now): Promise<{ accountId: string; maskedParent: string; state: 'pending' | 'confirmed' } | null>`: validates without consuming (token format, purpose, not used, not expired, bound `parent_email` equals the account's current one).
- `confirmConsent(db, token, now): Promise<'confirmed' | 'invalid'>`: one transaction with `SELECT ... FOR UPDATE` on the account; sets `consent_state = 'confirmed'`, `consent_at = now`, marks the token used, deletes the account's other unused confirm tokens. Idempotent-safe: an already used token is `invalid`.
- `withdrawConsent(db, token, now): Promise<'withdrawn' | 'invalid'>`: validates a withdraw token then calls `deleteAccount`.
- `signUp` (lib/accounts/signup.ts): the replace branch also deletes `account_consent_tokens` for the replaced account id (in the same transaction).

- [ ] **Step 1: Failing tests** in `tests/unit/account-consent.test.ts` (PGlite, fixed clock, existing helpers from `account-sessions.test.ts`): issue returns null for an unverified, a `none`, and an already `confirmed` account; confirm token confirms and records `consent_at`; reuse of the token is `invalid`; expired (31 days) is `invalid`; a confirm token never works as a withdraw token and vice versa; token for account A cannot affect account B; changing `parent_email` in SQL invalidates outstanding tokens; withdraw leaves zero rows for that account in accounts, account_sessions, account_consent_tokens and zero `account_login_tokens` for its email, while another account's rows remain; issuing again revokes the old confirm token but the old withdraw token still works; replacing an unverified sign-up removes its consent tokens; a failed concurrent confirm cannot double-record (second returns `invalid`).
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/account-consent.test.ts` Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the migration, `delete.ts`, `consent.ts` and the signup change; mask the parent address with the existing masking helper (find it with grep in `lib/accounts` or `app/account/sign-in/link`; move it to `lib/accounts/wording.ts` if it is page-local).
- [ ] **Step 4: Run** `npx vitest run tests/unit/account-consent.test.ts tests/unit/migrate*.test.ts tests/unit/account-signup.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** `feat: parental consent tokens, confirm, withdraw and account deletion`.

---

### Task 2: Sweep (reminder, 30-day deletion, clear at 16) and worker wiring

**Files:**
- Create: `lib/accounts/consent-sweep.ts`
- Modify: `worker/main.ts`
- Test: `tests/unit/account-consent-sweep.test.ts`

**Interfaces:**
- Consumes: `issueConsentTokens`, `deleteAccount` (Task 1), `runJob`, `EmailMessage`.
- Produces: `claimConsentSweep(db, now): Promise<boolean>` (daily `job_runs` claim, job `consent-sweep`); `runConsentSweep(db, now, send, links: { base: string }): Promise<{ reminded: number; deleted: number; cleared: number }>`.
- Behaviour: (a) pending, verified accounts with `verified_at <= now - 30 days` are deleted via `deleteAccount`; (b) pending accounts with `verified_at <= now - 7 days`, `consent_reminded_at IS NULL` get fresh tokens, a reminder email to the parent and `consent_reminded_at = now`; send failure leaves `consent_reminded_at` unset so the next day retries; (c) accounts whose age group (derived with `ageGroupFor` from date_of_birth, as in the 3A policy) is no longer `teen_13_15` get `parent_email = NULL` and their consent tokens deleted. Never touches `none` accounts without a parent email, unverified accounts, or confirmed accounts for (a)/(b).
- The email text comes from a function `consentEmail(kind: 'request' | 'reminder', links)` in `lib/accounts/consent-email.ts` (Task 3 uses the same one), listing exactly what is collected (email, date of birth, interests, answers and scores; no public comments, no profile page), the privacy notice URL, the confirm link, the withdraw link and the 30-day deadline.

- [ ] **Step 1: Failing tests** (fixed clock): day 6 nothing; day 7 one reminder and not a second the same or next day; day 30 deleted with all its rows; a confirmed account at day 40 untouched; unverified untouched by this sweep (the 48 hour purge owns it); a reminder send failure leaves it retryable; a 16th-birthday account loses parent_email and tokens; a 15-year-old is untouched; `tick` in worker runs the sweep once per UTC day (extend the existing tick test the way `account-retention.test.ts` does).
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement**; wire into `worker/main.ts` after `accountPurge` using the same claim + `runJob` pattern; keep imports bundle-safe (`tests/unit/worker-bundle.test.ts` must still pass).
- [ ] **Step 4: Run** `npx vitest run tests/unit/account-consent-sweep.test.ts tests/unit/account-retention.test.ts tests/unit/worker-bundle.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** `feat: consent reminder at 7 days, deletion at 30, parent email cleared at 16`.

---

### Task 3: Routes, pages, sending and the account page

**Files:**
- Create: `lib/accounts/consent-email.ts` (if not created in Task 2), `lib/accounts/consent-web.ts`, `app/account/consent/page.tsx`, `app/account/consent/confirm/route.ts`, `app/account/consent/withdraw/page.tsx`, `app/account/consent/withdraw/confirm/route.ts`, `app/account/consent/resend/route.ts`
- Modify: `lib/accounts/web.ts` (`confirmAccountLink`), `app/account/page.tsx`, `lib/accounts/wording.ts`
- Test: `tests/unit/account-consent-web.test.ts`, extend `tests/e2e/accounts.spec.ts`

**Interfaces:**
- `consent-web.ts` exports plain request functions in the style of `lib/accounts/web.ts` (same-origin check, `Deps`): `confirmConsentRequest`, `withdrawConsentRequest`, `resendConsentRequest`. Confirm/withdraw responses are 303 redirects to `/account/consent/?done=confirmed` or `?done=withdrawn` (no token, no address in the URL); an invalid token goes to `?invalid=1`. Per-network limiter for confirm/withdraw reuses `confirmLimits`.
- `confirmAccountLink`: after a successful consume, if the account is `pending`, `defer` `issueConsentTokens` + one `consentEmail('request')` to the parent (budget-gated by `accountSendBudget`, errors logged without the address). It never sends on sign-in links for already-confirmed accounts and never on sign-up.
- `resendConsentRequest`: needs a valid account session whose account is pending; at most one per hour per account (use a `job_runs`-free in-memory limiter keyed on account id from `lib/accounts/limits.ts`); redirects back to `/account/?consent=resent`.
- `/account/consent/` GET page: with `?token=` shows what is collected, the masked parent address and a POST button (confirm) when `consentTarget` is valid; `?token=&withdraw` style is NOT used, withdraw has its own page showing the deletion consequences and a POST button; `?done=` and `?invalid=1` show a plain result. All pages 404 when the flag is off, are `noindex`, and meet the accessibility rules (labelled buttons, headings, 320px reflow, focus after redirect lands on the result heading).
- Account page: a pending account shows "Waiting for your parent or guardian to confirm" with the resend button; a confirmed one shows the date consent was recorded.

- [ ] **Step 1: Failing unit tests** for: consent email sent once after the first confirm for a pending account and not for `none`/`confirmed` accounts; no email on sign-up or on a sign-in link request; budget-blocked send is silent; GET of the confirm page changes no row; POST confirm without same-origin is 403; resend limited to once an hour and refused for a non-pending account or no session; responses and URLs contain no parent address or token.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** routes thin over `consent-web.ts`, following the existing account routes for the flag guard and layout.
- [ ] **Step 4: E2E** in `tests/e2e/accounts.spec.ts`: a 14-year-old signs up with a parent email, confirms their own link, the parent's confirm page (token taken from the captured email as the existing spec captures sign-in links) lists what is collected, confirming shows the done state and the account page then shows consent recorded; a withdraw link deletes the account (signing in again says no account); axe has no violations on the new pages at 320px and desktop.
- [ ] **Step 4b: Run** the unit tests above, then `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts` (kill stale e2e-db/next processes first, `git checkout docs/screenshots` afterwards). Expected: PASS.
- [ ] **Step 5: Commit** `feat: parent consent and withdrawal pages, emails and account status`.

---

### Task 4: Isolation tests, docs and tracker

**Files:**
- Modify: `tests/unit/account-isolation.test.ts`, `docs/OPERATIONS.md` (Accounts section), `docs/superpowers/plans/2026-10-30-roadmap-tracker.md`, `docs/superpowers/plans/2026-11-03-project-3a-accounts-core.md` (mark the 3B notes done)
- Modify if present: the privacy notice page text only to link/describe the parent flow (keep existing copy otherwise; flag it as a draft for the professional review).

- [ ] **Step 1:** Turn the relevant `it.todo` rows in `account-isolation.test.ts` into tests: 13 to 15 pending account denied circle, invite, comment, contribute; 13 to 15 confirmed allowed circle/invite, denied public comment, community join, contribute, profile page, child profiles; tampered/foreign consent token denied; a parent token cannot sign anyone in or read any account data (it only reaches the confirm/withdraw pages).
- [ ] **Step 2:** OPERATIONS.md: the consent flow, the daily `consent-sweep` job and thresholds (7/30 days, 30-day confirm link), what to check if a parent says no email arrived (resend button, spam, MailerSend log), the new personal-data location (parent email, consent_at), and that the migration 008 is expand-only with its rollback. Tracker: 3.2 and 3.3 status.
- [ ] **Step 3: Run** the full unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files. Expected: all pass, 0 errors.
- [ ] **Step 4: Commit** `docs: parental consent operations, isolation matrix rows and tracker`.
