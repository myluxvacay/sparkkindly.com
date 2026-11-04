# Project 3C: Child profiles and the adult PIN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An account holder aged 18 or over, who confirms they are the child's parent or guardian and sets a 4-digit PIN, can create child profiles (display name plus age band 6-9 or 10-12), switch the session into a profile, and only switch back (or reach settings) with the PIN; a child profile only ever sees `kids` and `all` items and cannot reach settings, invites, comments, contribute or admin.

**Architecture:** `lib/accounts/children.ts` (profile CRUD and guardian confirmation), `lib/accounts/pin.ts` (hash, verify, lockout), `lib/accounts/context.ts` (the server-derived active context: account, active profile, allowed audiences, allowed actions). Routes thin under `app/account/children/`. Behind `ACCOUNTS_ENABLED`. Follows `.claude/rules/data-isolation.md` throughout.

**Tech Stack:** Next.js 16 route handlers, TypeScript, `pg`/PGlite, `node:crypto` scrypt, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` section 4a.5 (rows: who is a child, what is held, what is never held, who enters it, who can see it, consent and authorisation, access and deletion, age-out, shared devices) and Project 3 "Child profiles".

## Global Constraints

- Held about a child, and nothing else: display name (1 to 30 characters, no `@`, no digits-only email-like strings, trimmed), age band `6-9` or `10-12`, owner account id, created_at. Never email, date of birth, surname, photo, location, free text beyond the name.
- Creating a profile needs: session account with `ageGroupFor` = adult (18+) AND `can(group, consent, 'create_child_profile')` AND a guardian confirmation checkbox recorded as `accounts.guardian_confirmed_at` (set the first time, with timestamp) AND a PIN set at first creation.
- PIN: exactly 4 digits, stored only as a scrypt hash with a per-account random salt (never logged); 5 wrong attempts lock PIN entry for 15 minutes (per account); correct entry resets the counter. Comparison constant time.
- The active profile is stored server-side on the session row (`account_sessions.active_profile_id`), never taken from a request field. A profile id must belong to the session's account (cross-account id rejected even if valid).
- Child context: audiences `['kids', 'all']` (never `adults`), no sponsorship, no comments, no invites, no settings, no contribute, no admin, no PIN-less switch back. Only reading, playing and answering allowed.
- Deleting a profile removes all its rows immediately (cascade); marking a child 13 or over closes (deletes) the profile and says the teen may open their own account.
- Migrations expand-only with rollback in the header. No third-party requests, no storage identifiers on Kids pages (existing e2e privacy test stays green).
- Commits: no AI trailers. TDD. Pages meet WCAG 2.2 AA and are usable at 320px.

## Review Focus

- Account A's profile id presented by account B (switch, delete, answer) is rejected.
- A child context calling any settings, invite, comment, contribute or PIN-change route is denied server-side, not just hidden.
- Wrong PIN five times locks entry even when the later PIN is correct; the lock is per account.
- `adults` items never reach a child context through list, detail, search or daily set (reuse the `Scope` type in `lib/public/scope.ts` with `['kids','all']`).
- Deleting an account deletes its child profiles (cascade) and the profile rows leave nothing behind.

---

### Task 1: Migration, PIN and profile library

**Files:**
- Create: `db/migrations/009_child_profiles.sql`, `lib/accounts/pin.ts`, `lib/accounts/children.ts`
- Test: `tests/unit/account-pin.test.ts`, `tests/unit/account-children.test.ts`

**Interfaces:**
- Migration 009: `child_profiles (id uuid PK default gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30), age_band text NOT NULL CHECK (age_band IN ('6-9','10-12')), created_at timestamptz NOT NULL DEFAULT now())` with index on `account_id`; `ALTER TABLE accounts ADD COLUMN guardian_confirmed_at timestamptz, ADD COLUMN pin_hash text, ADD COLUMN pin_failures int NOT NULL DEFAULT 0, ADD COLUMN pin_locked_until timestamptz`; `ALTER TABLE account_sessions ADD COLUMN active_profile_id uuid REFERENCES child_profiles(id) ON DELETE SET NULL`. Rollback in the header.
- `setPin(db, accountId, pin: unknown): Promise<'set' | 'invalid'>`, `checkPin(db, accountId, pin: unknown, now: Date): Promise<'ok' | 'wrong' | 'locked'>`.
- `createChildProfile(db, accountId, input: { displayName: unknown; ageBand: unknown; guardianConfirmed: unknown; pin?: unknown }, now): Promise<{ status: 'created'; profileId: string } | { status: 'invalid' | 'not_allowed' | 'pin_required' }>`: re-derives age group and consent from the stored account row (never from the caller); sets `guardian_confirmed_at` and the PIN on first use.
- `listChildProfiles(db, accountId)`, `deleteChildProfile(db, accountId, profileId): Promise<boolean>` (false when the profile is not that account's), `closeChildProfileAsTeen` is the same as delete (document that).

- [ ] **Step 1: Failing tests:** valid create; teen (16-17) and 13-15 and pending accounts `not_allowed`; adult without guardian checkbox `invalid`; no PIN on first create `pin_required`; display name validation (empty, 31 chars, contains `@`, only digits); band validation; PIN must be 4 digits; wrong PIN x5 then correct is `locked` until 15 minutes pass; correct resets the counter; another account's profile cannot be deleted (returns false, row stays); deleting an account removes its profiles; the stored PIN hash is not the PIN and differs between accounts with the same PIN.
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/account-pin.test.ts tests/unit/account-children.test.ts`
- [ ] **Step 3: Implement** (scrypt with `crypto.scryptSync` and `timingSafeEqual`).
- [ ] **Step 4: Run** the same plus `tests/unit/migrate*.test.ts` and the full unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: child profiles, guardian confirmation and the adult PIN`.

---

### Task 2: Active context, switching and the child scope

**Files:**
- Create: `lib/accounts/context.ts`
- Modify: `lib/accounts/sessions.ts` (`getAccount` returns the active context), `lib/accounts/policy.ts` (a `childCan(capability)` helper: only read-only and play capabilities)
- Test: `tests/unit/account-context.test.ts`

**Interfaces:**
- `getContext(db, sessionToken, now): Promise<{ account: AccountView; profile: { id: string; displayName: string; ageBand: '6-9' | '10-12' } | null; audiences: readonly Audience[] } | null>`: adult context `audiences` by age group (child profile = `['kids','all']`; 18+ and teens per existing policy, `adults` only for 18+... follow the existing rule in `data-isolation.md`: a child profile or circle with one never gets `adults`).
- `switchToProfile(db, sessionToken, profileId, now): Promise<boolean>` (profile must belong to the session's account) and `switchToAdult(db, sessionToken, pin, now): Promise<'ok' | 'wrong' | 'locked'>`.
- `requireAdultContext(ctx)` helper that routes for settings, invites, comments, contribute and PIN change call; it fails closed for a child context.

- [ ] **Step 1: Failing tests:** adult context has no profile; switch sets the active profile; foreign profile id returns false and changes nothing; child context audiences exclude `adults`; `requireAdultContext` rejects a child context; switch back needs the right PIN, locks after 5 wrong; deleting the active profile returns the session to the adult context; a session cookie of account A never yields account B's context.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/unit/account-context.test.ts tests/unit/account-isolation.test.ts tests/unit/account-sessions.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** `feat: server-side active profile context and PIN-guarded switching`.

---

### Task 3: Routes, pages and e2e

**Files:**
- Create: `lib/accounts/children-web.ts`, `app/account/children/page.tsx`, `app/account/children/create/route.ts`, `app/account/children/switch/route.ts`, `app/account/children/delete/route.ts`
- Modify: `app/account/page.tsx`
- Test: `tests/unit/account-children-web.test.ts`, extend `tests/e2e/accounts.spec.ts`

- [ ] **Step 1: Failing unit tests:** each POST checks same-origin; no session is 303 to sign-in; a child context is denied on create, delete and settings-like routes (403); create rejects a profile id or account id in the form (ignored, server-derived); PIN never echoed in a URL or response; limiter on PIN attempts surfaces `locked` neutrally.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** thin routes over the library; pages list profiles (name, band), create form (name, band radios, guardian checkbox, PIN fields), switch buttons, delete with a confirm step, and a visible "Playing as <name>" banner with "Switch back (PIN)".
- [ ] **Step 4: E2E:** an adult signs up (18+), creates a profile with PIN, switches into it, sees no settings, cannot reach `/account/children/create`, wrong PIN denied, correct PIN returns; a 16-year-old sees no child profile option; axe on the new pages at 320px and desktop; the existing no-third-party-requests privacy test stays green.
- [ ] **Step 4b: Run** unit tests then `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts` Expected: PASS.
- [ ] **Step 5: Commit** `feat: child profile pages and switching`.

---

### Task 4: Isolation tests, docs and tracker

- [ ] **Step 1:** Turn the child rows of the `account-isolation.test.ts` matrix into real tests (child profile to `adults` denied across list/detail/search/daily set as far as those exist today; child to settings, invites, comments, contribute, admin denied; foreign profile id denied).
- [ ] **Step 2:** `docs/OPERATIONS.md`: what a child profile holds, deletion, PIN lockout and how an adult resets a forgotten PIN (decide: via sign-in link re-authentication, then PIN reset, recorded in the plan ledger as a ruling), data inventory rows. Tracker 3.4.
- [ ] **Step 3: Run** the full unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files.
- [ ] **Step 4: Commit** `docs: child profile operations and isolation matrix`.
