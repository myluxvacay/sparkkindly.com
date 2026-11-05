# Pilot measurement (roadmap P.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An admin-only page `/admin/pilot/` that shows the spec 4a.2 pilot metrics (activation, return, interest uptake, quality, operating effort) against the thresholds, computed from data the site already holds, plus a way to log the owner's weekly operating hours.

**Architecture:** `lib/admin/pilot.ts` (pure SQL aggregates over a window, thresholds as constants, no Next.js imports), one additive migration for the hours log, one admin action `ops.log_hours`, one thin page. No new tracking: nothing is collected from anonymous visitors, no cookie or identifier is added, no per-person row is shown.

**Tech Stack:** Next.js 16 server component, `pg`/PGlite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` section 4a.2 (thresholds table) and `.claude/rules/data-isolation.md`.

## Global Constraints

- Admin only: the page calls `requireAdmin()`; the action goes through `/admin/act/` (origin, session, CSRF, audit row) like every other admin change.
- Aggregates only: counts and percentages. No emails, ids or names reach the page.
- Privacy invariant preserved: no new cookie, no storage identifier, no third-party request, no change to any public page.
- Migration 013 is additive with a rollback line in the header.
- Thresholds are constants in one place (`PILOT_THRESHOLDS`) so the owner's final numbers (P.1) are a one-line change. Values: activation 40, return 30, interest uptake 60, quality under 2 per 100, operating effort under 2 hours a week.
- Commits carry no AI trailers. Do not push.

## Rulings (recorded here, replace the spec's visitor wording)

- Anonymous visitors cannot be followed without an identifier, which the privacy rules forbid. Pilot A participants sign up, so **activation, return and interest uptake are measured over accounts**, labelled "signed-in members". The spec's visitor-level activation is not measured; it is reported as "not measured (no visitor identifiers by design)".
- Circle value (Pilot B) is a hand tally by the owner; the page says so and shows no number for it.
- "Quality" = (`item.unpublish` + `item.edit` audit rows in the window whose target is an item that has a `published_at`) per 100 items whose `published_at` falls in the window. No published items in the window = no data.

## Metric definitions (window = accounts/items created or published in the last `days` days, default 21)

- **Members** = accounts with `verified_at` set and `created_at` in the window.
- **Activation** = members with at least one `item_responses` row (any profile) answered within 7 days of `created_at`, divided by members.
- **Return** = among activated members whose first answer is at least 7 days old, the share with another answer on a later UTC calendar day within 7 days after their first answer.
- **Interest uptake** = members with at least one `profile_interests` row (`profile_id IS NULL`), divided by members.
- Each metric returns `{ numerator, denominator, percent | null, threshold, met: boolean | null }`; a zero denominator gives `percent: null, met: null` ("no data yet").
- **Operating effort** = average of the last 4 logged weeks from `operating_hours`; met when under 2.

---

### Task 1: Metrics library and tests

**Files:** Create `lib/admin/pilot.ts`, `tests/unit/admin-pilot.test.ts`.

**Interfaces (produces):**
- `PILOT_THRESHOLDS`, `type Metric = { numerator: number; denominator: number; percent: number | null; threshold: number; met: boolean | null }`
- `pilotMetrics(db: Queryable, now: Date, days = 21): Promise<{ members: number; activation: Metric; returning: Metric; interestUptake: Metric; quality: Metric & { per100: number | null } }>`

- [ ] **Step 1: Failing tests** with PGlite (`newTestDb`, `seedReference`; create accounts by direct INSERT with explicit `created_at`, `verified_at`): zero members gives `percent: null, met: null` for all; 4 members, 2 answered within 7 days = activation 50 and met true at threshold 40, 1 answered after 8 days is not counted; return counts only activated members whose first answer is 7+ days old and who answered again on a later day within 7 days (answers on the same day do not count; day 8 does not count); interest uptake counts a member with a topic or world interest and ignores a child-profile interest; unverified accounts and accounts outside the window are excluded; quality counts `item.unpublish` and `item.edit` audit rows on published items only (an edit on a never-published draft is ignored) per 100 items published in the window, met when under 2; the result contains no email or id fields (assert on `Object.keys` of the JSON).
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/admin-pilot.test.ts`
- [ ] **Step 3: Implement** `pilotMetrics` with parameterised SQL (CTEs over `accounts`, `item_responses`, `profile_interests`, `audit_log`, `items`). Cast the audit target safely (`target ~ '^[0-9a-f-]{36}$'` before `::uuid`).
- [ ] **Step 4: Run** the test file, then `npx vitest run` for the unit suite and `rm -rf .next/types; npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: pilot metrics from existing data`.

### Task 2: Operating-hours log, admin page, docs

**Files:** Create `db/migrations/013_operating_hours.sql`, `app/admin/pilot/page.tsx`; modify `lib/admin/actions.ts` (+`DONE`/`ERRORS` codes in `lib/admin/messages.ts` if needed), `components/admin/AdminNav.tsx` (link "Pilot"), `lib/admin/pilot.ts` (+`operatingEffort(db, now)` and `recentHours`), `docs/OPERATIONS.md` (a short "Pilot measurement" section), `docs/superpowers/plans/2026-10-30-roadmap-tracker.md` (P.2).
Tests: extend `tests/unit/admin-pilot.test.ts`, `tests/unit/admin-actions.test.ts`, `tests/unit/admin-pages.test.ts` (follow the existing patterns in those files).

**Interfaces:** migration 013: `operating_hours (week_start date PRIMARY KEY, hours numeric(4,1) NOT NULL CHECK (hours >= 0 AND hours <= 80), note text CHECK (char_length(note) <= 200), logged_at timestamptz NOT NULL DEFAULT now())`. Action `ops.log_hours` (form: `week_start` a YYYY-MM-DD date, `hours` a number 0 to 80, optional `note`): upserts the week, audit row, redirects back to `/admin/pilot/`. Week start is normalised to the Monday of the given date.

- [ ] **Step 1: Failing tests:** the action upserts and a second call for the same week replaces it; rejects a non-date, hours below 0 or above 80, and a note over 200 characters with the existing 400 error shape; writes an audit row; an unauthenticated POST is refused by the existing act tests' pattern; `operatingEffort` averages the last 4 logged weeks and is `met: null` with no rows; the page redirects to sign-in without an admin session (see `admin-pages.test.ts`) and for a signed-in admin renders every metric label, the threshold, "no data yet" when empty, the Pilot B hand-tally note and the "not measured" line for visitors.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** the migration, the action, the page (headings per metric, a definition line each, a table for the last 8 logged weeks, a small form with a CSRF field via the existing `ActionForm` component), the nav link, the docs and tracker updates.
- [ ] **Step 4: Run** `npx vitest run`, `rm -rf .next/types; npx tsc --noEmit`, `npx eslint` on touched files, `npm run build`, then from Git Bash `SITE_RELEASE=false npx playwright test tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts` (axe on the new page at 320px: add one assertion in the admin e2e file following its existing pattern if it has an axe helper).
- [ ] **Step 5: Commit** `feat: pilot page, operating-hours log and docs`.

## Review Focus

- A non-admin, an expired admin session and a bad CSRF token cannot read the page or log hours.
- No metric leaks an email, account id or child-profile detail; child profiles count only inside account-level totals.
- A window with no data, or with one member, never divides by zero or reports a false pass.
- Re-posting the same week replaces, never duplicates; a date that is not a Monday is normalised.
