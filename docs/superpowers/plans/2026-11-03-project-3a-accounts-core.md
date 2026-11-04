# Project 3A: Account Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person aged 13 or over can create an account with a date of birth and sign in by emailed link; the server derives their age group and what they may do from one policy table. Nothing else in Project 3 (consent emails, child profiles, interests, export) is built here.

**Architecture:** One new module `lib/accounts/` (no Next.js imports) holds the policy, age-group derivation, sign-up, sign-in links and sessions, unit-tested on PGlite like `lib/admin/`. Thin routes under `app/account/` call it. Sessions are a separate cookie and table from admin sessions; an account session can never satisfy an admin check. Additive migration only.

**Tech Stack:** Next.js 16.4.2, zod 4, `pg`/PGlite, Vitest, Playwright with axe, the existing `sendEmail` (MailerSend).

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md`: Project 3, 4a.5 (the age and consent table), `.claude/rules/data-isolation.md`. Tracker 3.1 (email link only), 3.3, 3.9 (sign-up and sign-in limits).

## Scope and rulings

- **In:** accounts table, age groups and permission matrix as data, sign-up with date of birth, sign-in link, account session and sign-out, rate limits, `/account/*` pages, an adversarial test per `data-isolation.md`.
- **Out, later plans:** 3B parental consent flow and emails (3.2); 3C child profiles and PIN (3.4); 3D interests, `/me`, stored answers (3.5, 3.6); 3E notification preferences, export, deletion, inactivity job (3.7, 3.8); 3F legal drafts (3.10); Google sign-in (3.1 second half).
- **Ruling: Google sign-in is deferred.** It needs an owner-created Google OAuth client and sends visitors to a third party, which the privacy rules treat as an explicit decision. The email link covers every account holder meanwhile. Cost if wrong: Google users wait.
- **Ruling: nothing is stored for an under-13 sign-up.** The form says only that accounts start at 13 and points to child profiles (plan 3C). No date of birth, email or attempt is written, so there is nothing to delete.
- **Ruling: the date of birth is stored, the age group is not.** The group is derived from the date on every request, so a birthday moves the account without a job. The 13-to-15 account holds `consent_state = 'pending'` from sign-up; 3B moves it to `confirmed`. Until then permissions are those of an anonymous visitor plus saving interests (spec 4a.5).
- **Ruling: the policy is a table in code, one file.** `lib/accounts/policy.ts` holds the minimum age (13), the consent age (16) and the capability matrix, so the professional review changes policy in one place (spec: "settings, not scattered logic").
- **Ruling: live only behind `ACCOUNTS_ENABLED`.** Routes return 404 unless the env flag is set, because the spec requires the professional review before accounts go live. Staging sets it; production does not. Cost if wrong: none.
- No push, deploy, server change or production touch; commits carry no AI co-author trailers.

## Global Constraints

- Server-derived context is authoritative: the account comes from the session cookie, never from a submitted id (`data-isolation.md`).
- Missing context fails closed: no session means anonymous capabilities.
- Age-group permissions are enforced on the server from the date of birth and consent state.
- A sign-in cookie only: no tracking cookie, no third-party request, no storage identifier on Kids pages (the existing privacy e2e must still pass).
- Link and session tokens are random, shown once, stored only as sha256 hashes (same as `lib/admin/sessions.ts`).
- Emails sent only for sign-in; one message per request; the response never says whether an address has an account.
- Migrations additive with a stated rollback; routes thin; files small.

## Review Focus

1. **Account enumeration:** requesting a link for an unknown address and for a known one return the same response and take similar time. Pinned in Task 3.
2. **Birthday arithmetic:** a person turning 13, 16 or 18 today; 29 February births; a future date of birth; a date in the 1900s. Pinned in Task 1.
3. **Session confusion:** an account session cookie presented to an admin route; an admin session presented to an account route. Pinned in Task 3.
4. **Link replay and expiry:** a used or expired link, a link for a different account, a tampered token. Pinned in Task 3.
5. **Sign-up abuse:** many sign-ups from one address or network; a 13-to-15 sign-up naming the account holder's own address as the parent's. Pinned in Tasks 2 and 3.

---

### Task 1: Policy and age groups

**Files:**
- Create: `lib/accounts/policy.ts`, `tests/unit/account-policy.test.ts`

**Interfaces:**
- Produces: `type AgeGroup = 'under_13' | 'teen_13_15' | 'teen_16_17' | 'adult'`; `type Capability = 'save_interests' | 'join_circle' | 'create_circle' | 'public_comment' | 'join_community' | 'contribute' | 'create_child_profile' | 'see_sponsorship' | 'essential_email' | 'marketing_email'`; `POLICY: { minAge: 13; consentAge: 16; adultAge: 18 }`; `ageGroupFor(dob: string, now: Date): AgeGroup | null` (null for an unparsable, future or pre-1900 date); `can(group: AgeGroup, consent: 'none' | 'pending' | 'confirmed', cap: Capability): boolean`.

- [ ] **Step 1: Write the failing tests** `ageGroupFor` at the day before and the day of each birthday (13, 16, 18), a 29 February birth on 28 February and 1 March of a non-leap year, a future date, `1899-12-31`, `'not a date'`; and the full `can` matrix as a table test that mirrors the 4a.5 rows (13 to 15 pending: only `save_interests` and `essential_email`; confirmed: adds `join_circle` and `create_circle`, never `public_comment`, `join_community`, `contribute`, `create_child_profile`, `see_sponsorship`; 16 to 17 all but `create_child_profile` and `see_sponsorship`; adult everything).
- [ ] **Step 2: Run to confirm they fail** `npx vitest run tests/unit/account-policy.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above; date arithmetic on UTC calendar dates, no `Date` locale parsing.
- [ ] **Step 4: Run to confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: account policy and age groups as one table`.

### Task 2: Accounts migration and sign-up

**Files:**
- Create: `db/migrations/007_accounts.sql`, `lib/accounts/signup.ts`, `tests/unit/account-signup.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ageGroupFor`, `POLICY`).
- Produces: tables `accounts (id uuid pk, email text unique lower, date_of_birth date, time_zone text, consent_state text check in ('none','pending','confirmed'), parent_email text null, created_at)`, `account_login_tokens`, `account_sessions` (shapes as in `005_admin.sql`, keyed by hash, no `stage`); `signUp(db, input: { email: unknown; dateOfBirth: unknown; parentEmail?: unknown; timeZone?: unknown }, now: Date): Promise<{ status: 'created'; accountId: string } | { status: 'under_13' | 'invalid' | 'parent_required' | 'exists' }>`.

- [ ] **Step 1: Write the failing tests** under 13 writes no row; 13 to 15 requires a parent email that differs from the account's own and is stored as `consent_state = 'pending'`; 16 and over stores `none`; a duplicate email returns `exists` (the route maps it to the same response as `created`); invalid email, future date and an unknown time zone fall back to `UTC`; and the migration header states a rollback (`DROP TABLE account_sessions, account_login_tokens, accounts`).
- [ ] **Step 2: Run to confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the migration and `signUp` in one transaction; email lower-cased and trimmed; time zone validated with `Intl.supportedValuesOf('timeZone')`.
- [ ] **Step 4: Run to confirm they pass**, then `npx vitest run tests/unit/migrations.test.ts` (existing). Expected: PASS.
- [ ] **Step 5: Commit** `feat: accounts table and sign-up with age gating`.

### Task 3: Sign-in link and sessions

**Files:**
- Create: `lib/accounts/sessions.ts`, `tests/unit/account-sessions.test.ts`

**Interfaces:**
- Consumes: Task 2 tables; `linkBase(env)` from `lib/admin/sessions.ts`.
- Produces: `requestAccountLink(db, email: string, env, now): Promise<string | null>` (token, or null and nothing written for an unknown address); `consumeAccountLink(db, token: string, now): Promise<string | null>` (session token); `getAccount(db, sessionToken: string, now): Promise<{ id: string; email: string; ageGroup: AgeGroup; consent: 'none'|'pending'|'confirmed' } | null>`; `endAccountSession(db, sessionToken)`.

- [ ] **Step 1: Write the failing tests** a known address gets a token and an unknown one gets null with zero rows; a link works once and expires after 15 minutes; a tampered or wrong-length token is null; a session lasts 30 days idle-refreshing and ends on sign-out; **an account session token is rejected by `getAdmin`, and an admin session token is rejected by `getAccount`**; `getAccount` re-derives the age group from the stored date each call (a clock set after the 16th birthday changes the group).
- [ ] **Step 2: Run to confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** reusing the hashing and token helpers from `lib/admin/sessions.ts` by exporting them from one small shared file `lib/tokens.ts` (move, do not copy; admin tests must stay green).
- [ ] **Step 4: Run** the new test and `tests/unit/admin-sessions.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: account sign-in links and sessions, separate from admin`.

### Task 4: Routes, pages and limits

**Files:**
- Create: `lib/accounts/limits.ts`, `app/account/sign-up/page.tsx`, `app/account/sign-in/page.tsx`, `app/account/sign-in/link/route.ts`, `app/account/sign-out/route.ts`, `app/account/page.tsx`, `tests/unit/account-limits.test.ts`, `tests/e2e/accounts.spec.ts`
- Modify: `lib/config.ts` (the `ACCOUNTS_ENABLED` flag)

**Interfaces:**
- Consumes: Tasks 1 to 3; `createSignInLimits`, `clientKey`, `sameOrigin` from `lib/admin/guard.ts`.
- Produces: `createSignUpLimits(clock?)` with 5 sign-ups per network per hour; sign-in link requests limited per address and per network as the admin ones are.

- [ ] **Step 1: Write the failing tests** limits unit test (sixth sign-up in an hour refused with a retry time); e2e: with the flag off every `/account/*` is 404; with it on, a 20-year-old signs up, requests a link (read from the test mail sink), lands on `/account` showing their email and age group wording, signs out; a 12-year-old sees the child-profile message and nothing is stored; a 14-year-old is asked for a parent's email and `/account` says consent is pending; axe finds no serious or critical violation on both forms; the existing privacy e2e still passes (only the sign-in cookie, `HttpOnly`, `SameSite=Lax`, `Secure` on https).
- [ ] **Step 2: Run to confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** thin routes: parse, call `lib/accounts/`, redirect or render; forms work without JavaScript; errors never reveal whether an address exists.
- [ ] **Step 4: Run** the unit tests and `npx playwright test tests/e2e/accounts.spec.ts` with the e2e harness quirks noted in the tracker. Expected: PASS.
- [ ] **Step 5: Commit** `feat: account sign-up and sign-in pages behind ACCOUNTS_ENABLED`.

### Task 5: Adversarial matrix and documentation

**Files:**
- Create: `tests/unit/account-isolation.test.ts`
- Modify: `docs/OPERATIONS.md` (the flag and how to turn accounts on for staging), the tracker (3.1 email link, 3.3, 3.9 progress)

- [ ] **Step 1: Write the tests** from `data-isolation.md`: own account allowed; account A cannot read B through a tampered id in any payload; no session gets anonymous capabilities only; a 13 to 15 account denied `public_comment`, `join_community`, `contribute`; a 16 to 17 account denied `create_child_profile`; a missing or expired session fails closed.
- [ ] **Step 2: Run, fix any gap found in Tasks 1 to 4 with its own failing test first, run the full unit suite, `tsc` and eslint.** Expected: all green, results recorded.
- [ ] **Step 3: Independent review:** this is High-risk (children's age data, consent). Dispatch `data-isolation-reviewer` and `security-auditor`; resolve findings before any merge.
- [ ] **Step 4: Commit** `docs: account flag and tracker progress`.

## Carried to later plans

Notes from the final reviews (3 November 2026). Not built in 3A.

- **3B (consent), done in 3B:** consent email only after `verified_at`; token bound to account id and exact parent email; tokens revoked on parent change; `parent_email` cleared at 16; 7-day reminder and 30-day deletion (`consent-sweep`). **Remaining:** a neutral age screen and same-browser retry block (deferred to the privacy review); a sign-up over a verified address already changes nothing (isolation test), so a confirmed row is not overwritable. Original note: send the parent consent email only after `verified_at` is set; bind the consent token to the account id and the exact parent email it was sent to; revoke consent tokens on any overwrite or parent change; decide whether a `confirmed` row is locked against overwrite; decide whether `parent_email` is cleared at 16; a neutral age screen and a same-browser retry block (privacy review). Spec 4a.5 also says an unconfirmed (consent-pending) 13-15 account gets a reminder at 7 days and is deleted after 30 days: 3B must implement that; the 3A 48-hour purge covers only email-unverified rows.
- **Owner to reconcile before Project 4:** the spec's risk table says no profile pages exist for anyone, while 4a.5 and `lib/accounts/policy.ts` give `profile_page` to 16 and over.
- Done in 3A (final residuals): a database error on link confirm (e.g. a lock wait past the 3 s `statement_timeout`) now returns the generic invalid-link page instead of a 500.
- **3C (child profiles):** an adult's `create_child_profile` needs a recorded guardian confirmation, not `can` alone; a child profile's audience scope passes `['kids', 'all']`.
- **3E (export and deletion):** delete `account_login_tokens` by email on account deletion (there is no foreign key); list every personal-data table in `docs/OPERATIONS.md` (Accounts, "Personal data held") in the export test.
- **Go-live gates:** professional privacy review, the 3B consent flow, a 320px and screen-reader pass.
