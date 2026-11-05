# Project 4A: Circles core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A signed-in account holder can create a circle (friends, family or community), see their circles, leave one, and as owner remove a member, transfer ownership, or close the circle; an adult can add their own child profile to a family circle. No invites, daily set or scores yet (4B, 4C).

**Architecture:** `lib/circles/` (rules, repo, owner actions; no Next.js imports) over migration 014; thin routes and pages under `app/circles/`; a retention job that deletes circles closed for 30 days. Behind `ACCOUNTS_ENABLED` AND a new `CIRCLES_ENABLED` (both off everywhere). Follows `.claude/rules/data-isolation.md`.

**Tech Stack:** Next.js 16, TypeScript, `pg`/PGlite, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 4 ("Circles", "Circle rules", "Moderation"), section 4a.5, and the owner decision of 4 November 2026 (built ahead of the pilot gate).

## Global Constraints

- Server-derived context only: the acting account comes from the session (`getContext`/`requireAdultContext`); circle, member and profile ids from the form are validated against that account's rights, never trusted. A child-profile context is denied on every circle write and sees no circle pages in 4A.
- Capability gates from `lib/accounts/policy.ts`: create/join need `create_circle`/`join_circle` (so a consent-pending 13-15 account is denied). Rulings: **family** and **community** circles are created by 18+ only; teens (13-17) create **friends** circles; a circle that contains any child profile admits **18+ members only**.
- Name 1 to 40 characters, trimmed, NFKC-normalised, passes the existing blocked-words check (`lib/items/blocked.ts`); description (community only) up to 200 characters, same check.
- Limits (rulings, constants in `lib/circles/rules.ts`): an account owns at most 5 open circles and belongs to at most 10; a circle holds at most 30 members (a member being an account or a child profile).
- Circle slug: 10 random lowercase-alphanumeric characters (unguessable; never derived from the name). URL `/circles/<slug>/`.
- A member leaving keeps a `left_at` timestamp (4C shows past contributions as "former member"); member lists show current members only. Account deletion cascades its rows.
- Owner rules: remove a member, transfer ownership to another **adult (18+) account member**, close the circle. If the owner's account is deleted: ownership passes to the longest-standing other adult account member; if none, the circle is closed. A closed circle is read-only and is deleted (rows cascade) 30 days after `closed_at`.
- Adding a child profile needs a confirmation checkbox ("everyone in this circle sees this display name and its scores"), is allowed only for the profile's own adult, only into a **family** circle that adult is a current member of.
- Migration 014 is additive with a rollback line in the header. Commits carry no AI trailers; do not push.

## Review Focus

- Account A cannot act on circle B (not a member), on another owner's circle as owner, or with another account's profile id; a forged `circle`, `member` or `profile` id is rejected and changes nothing.
- A non-owner cannot remove, transfer or close; an owner cannot transfer to a teen or a non-member; a closed circle accepts no writes.
- A circle with a child profile can never gain a 13-17 member; a child profile can never be in a friends/community circle.
- Owner deletion never leaves an ownerless open circle; two members racing (leave vs remove, transfer vs close) leave consistent rows (lock the circle row `FOR UPDATE` in each owner action).
- Export lists the account's own memberships and nothing about other members; deletion removes every circle row for the account (the completeness tests in `account-export.test.ts` and the deletion test must be extended, not weakened).

---

### Task 1: Migration, flag, create, list, view, leave

**Files:** Create `db/migrations/014_circles.sql`, `lib/circles/rules.ts`, `lib/circles/repo.ts`, `tests/unit/circles-repo.test.ts`; modify `lib/config.ts` (`circlesEnabled()` = `accountsEnabled() && CIRCLES_ENABLED in {true,1}`), `deploy/env/*.example` (empty-by-default `CIRCLES_ENABLED=`).

**Interfaces (produces):**
- Tables: `circles (id uuid PK default gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL CHECK in ('friends','family','community'), description text, owner_account_id uuid NOT NULL REFERENCES accounts(id) (plain FK, no cascade: `deleteAccountIn` must hand over or close owned circles in the same transaction before deleting the account row), time_zone text NOT NULL DEFAULT 'UTC', status text NOT NULL DEFAULT 'open' CHECK in ('open','closed'), closed_at timestamptz, hidden_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`; `circle_members (circle_id uuid REFERENCES circles ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE, profile_id uuid, role text NOT NULL DEFAULT 'member' CHECK in ('owner','member'), joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, FOREIGN KEY (profile_id, account_id) REFERENCES child_profiles (id, account_id) ON DELETE CASCADE)` with a unique index on `(circle_id, account_id, COALESCE(profile_id, zero-uuid))` and an index on `account_id`. `owner_account_id` and role `owner` are kept consistent by the owner actions.
- `rules.ts`: `LIMITS`, `validateCircleInput(input: unknown): { ok: true; value: { name; kind; description: string | null; timeZone: string } } | { ok: false }` (time zone must be a valid IANA zone, default the account's), `canCreateKind(group: AgeGroup, consent: Consent, kind): boolean`.
- `repo.ts`: `createCircle(db, accountId, input, now): Promise<{ status: 'created'; slug: string } | { status: 'invalid' | 'not_allowed' | 'limit' }>` (re-derives age group and consent from the account row; owner becomes an `owner` member in the same transaction); `listMyCircles(db, accountId): Promise<CircleSummary[]>` (open circles the account currently belongs to, with member counts); `getCircleForMember(db, accountId, slug): Promise<CircleView | null>` (null for non-members, left members, hidden circles; includes current members' display names: account members show the account's display handle = the part of the email before `@`? **No**: add `accounts.display_name`? Not available. **Ruling:** members of a circle are shown by a name chosen per circle: `circle_members.display_name text NOT NULL CHECK (char_length BETWEEN 1 AND 30)`, defaulting at create/join to the name the person types (required field "Your name in this circle"; child profiles use their profile display name); the email is never shown to other members); `leaveCircle(db, accountId, slug): Promise<'left' | 'owner_must_transfer' | 'not_member'>` (an owner must transfer or close first; leaving removes the account's child profiles from that circle too).

- [ ] **Step 1: Failing tests** (PGlite): create friends by an adult and by a 16-year-old and by a confirmed 13-15; pending 13-15 `not_allowed`; teen creating family or community `not_allowed`; invalid names (empty, 41 chars, blocked word, only spaces); the 5-owned and 30-member limits; slug is 10 chars and differs per circle; the owner is a member with role owner and the name they typed; `listMyCircles` returns only that account's; `getCircleForMember` null for a non-member and for a left member and for a hidden circle; the view never contains an email field (assert on JSON); leave works for a member, is refused for the owner, and a left member can be re-listed as not a member.
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/circles-repo.test.ts`
- [ ] **Step 3: Implement** (parameterised SQL, one transaction per write, `FOR UPDATE` on the account row when counting limits).
- [ ] **Step 4: Run** the new file, `tests/unit/migrate*.test.ts` and the whole unit suite. Expected: all pass.
- [ ] **Step 5: Commit** `feat: circles tables, creation, listing and leaving`.

### Task 2: Owner actions, child profiles in family circles, deletion, export, purge job

**Files:** Create `lib/circles/owner.ts`, `lib/circles/children.ts`, `lib/jobs/circles-purge.ts`, `tests/unit/circles-owner.test.ts`, `tests/unit/circles-children.test.ts`, `tests/unit/circles-purge.test.ts`; modify `lib/accounts/delete.ts` (`deleteAccountIn` hands over or closes owned circles first, in the same transaction, locking each circle), `lib/accounts/export.ts` (+ `circle_members` export: circle name, kind, role, your name in it, joined_at, left_at, and nothing about other members; `circles` added to `EXCLUDED_TABLES` with the reason "circle data shared by its members; the export lists the account's own memberships"), `worker/main.ts` (register the purge after the inactivity sweep, same guards as `lib/jobs/guards.ts`), `tests/unit/account-export.test.ts` and the deletion test for the new tables.

**Interfaces (produces):**
- `removeMember(db, ownerId, slug, memberKey: { accountId: string; profileId: string | null }): Promise<'removed' | 'not_owner' | 'not_found' | 'is_owner' | 'closed'>`, `transferOwnership(db, ownerId, slug, toAccountId): Promise<'transferred' | 'not_owner' | 'not_eligible' | 'closed'>` (target must be a current adult account member, not the caller), `closeCircle(db, ownerId, slug): Promise<'closed' | 'not_owner' | 'closed'>` (sets `status`, `closed_at`).
- `addChildToCircle(db, accountId, slug, profileId, confirmed: unknown, yourName?): Promise<'added' | 'invalid' | 'not_allowed' | 'not_family' | 'has_teen' | 'limit' | 'already'>`; `removeChildFromCircle(db, accountId, slug, profileId): Promise<boolean>`. A child may be added only if no current member is 13-17 (an adult-only circle), and `circle_members` rows for teens are refused later by the join path in 4B using the same helper `circleHasChild(db, circleId)`.
- `purgeClosedCircles(db, now, cap = 100): Promise<number>` deletes circles with `closed_at < now - 30 days` (cascade), run through the daily-claim `runJob` pattern used by the consent sweep.

- [ ] **Step 1: Failing tests:** each owner action succeeds for the owner and is `not_owner` for a plain member and for a stranger; transfer to a teen, a non-member and self refused; closing blocks every later write; removing a member sets nothing on others; forged ids change nothing; owner-account deletion with another adult member passes ownership to the longest-standing adult account member, with none closes the circle, and never leaves an open circle ownerless; a child can be added by its own adult only into a family circle the adult belongs to, not into friends or community, not by another adult, not without the confirmation; adding a child to a circle that has a 13-17 member is `has_teen`; two concurrent leave/remove or transfer/close calls leave valid rows (run with `Promise.all` and assert the invariant: exactly one owner on an open circle); the purge deletes only circles closed over 30 days ago, respects the cap, and leaves open circles; export includes the account's memberships and no other member's data; the completeness test fails if `circle_members` or `circles` were in neither list (assert both are accounted for).
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.** Lock order: circle row first, then account rows.
- [ ] **Step 4: Run** the new files, `account-export`, `account-delete*`/`account-consent*` tests, the worker bundle test and the whole unit suite.
- [ ] **Step 5: Commit** `feat: circle owner actions, child profiles in family circles, deletion and purge`.

### Task 3: Routes, pages and e2e

**Files:** Create `lib/circles/web.ts`, `app/circles/page.tsx`, `app/circles/new/page.tsx`, `app/circles/create/route.ts`, `app/circles/[slug]/page.tsx`, `app/circles/[slug]/{leave,remove,transfer,close,add-child,remove-child}/route.ts`, `tests/unit/circles-web.test.ts`; extend `tests/e2e/accounts.spec.ts` (or a new `circles.spec.ts` following its fixtures), `components/` for small shared pieces if needed. Keep routes thin (parse, call `lib/circles`, redirect with a message code).

- [ ] **Step 1: Failing unit tests (web layer):** with either flag off every route 404s; each POST checks same-origin, requires an adult context (a child context gets 403), and ignores any account id in the form; a non-member GET of `/circles/<slug>/` is 404 (not 403, so existence does not leak); the page and responses never include another member's email; per-account limiter on create and on member actions (reuse `lib/accounts/limits.ts`).
- [ ] **Step 2: Run, watch fail.** **Step 3: Implement** pages: my circles + "Create a circle" (name, kind radios with one-line explanations, "your name in this circle", time zone select defaulting to the account's, description for community), circle page (name, kind, member list with names and roles, owner controls with confirm steps, add-child form with the visible warning and checkbox, leave button), plain messages for each outcome. Semantic HTML, labelled controls, usable at 320px, no JS required.
- [ ] **Step 4: E2E** (`CIRCLES_ENABLED=true` set in `playwright.config.ts` test env): an adult creates a family circle and adds a child profile; a second adult account cannot open it (404); the owner transfers and the new owner sees controls; the old owner leaves; axe at 320px and desktop on the three pages; the existing privacy and accessibility tests stay green. Run `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/circles.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts` from Git Bash.
- [ ] **Step 5: Commit** `feat: circle pages and routes`.

### Task 4: Isolation matrix, docs, tracker

- [ ] **Step 1:** Add the circle rows to `tests/unit/account-isolation.test.ts`: own circle allowed; account B's circle denied; non-member denied; child context denied on every circle write; tampered circle/member/profile id denied; teen member of a circle with a child refused; an `owner` action by a plain member denied.
- [ ] **Step 2:** `docs/OPERATIONS.md`: "Circles" section (flags, limits, owner rules, what a circle holds and shows, deletion and 30-day purge, rollback of migration 014 and turning `CIRCLES_ENABLED` off). `docs/legal/data-inventory.md` rows for `circles` and `circle_members` and a line in `go-live-copy-changes.md`. Tracker 4.1 and 4.9 (the 13-15 community rule is 4B).
- [ ] **Step 3:** Run the whole unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files, `npm run build`. **Step 4: Commit** `docs: circles operations and isolation matrix`.
