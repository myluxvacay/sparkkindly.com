# Project 3D: Interests, the `/me` dashboard and stored answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in profile (an adult or teen account, or a child profile) picks topics and worlds it cares about; `/me` shows today's and recent items matching them, what the profile has answered, and progress without streaks or pressure; answers to playable items are saved per profile with correctness and time; "today" follows the account's time zone.

**Architecture:** `lib/accounts/interests.ts` (pick and read interests), `lib/accounts/responses.ts` (record and read answers), a `save_answers` capability in `lib/accounts/policy.ts`, a thin hook in the existing play-answer route, and `/me` pages under `app/me/` that read through the existing `listPublic`/`getPublicItem` with the scope from `getContext(...).audiences`, so audience filtering stays the one safety filter. Behind `ACCOUNTS_ENABLED`.

**Tech Stack:** Next.js 16 route handlers and server components, TypeScript, PostgreSQL (18 in dev; migrations must also work on the production version, so no `NULLS NOT DISTINCT`: use a partial or `COALESCE` unique index), PGlite in tests, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 3 (Interests, Stored answers, Time zone), section 4a.5 (what is held about a child: interests, answers with correctness and time; no behavioural tracking of child profiles) and `.claude/rules/data-isolation.md`.

## Global Constraints

- A profile's data is scoped by account id AND profile id (NULL profile id = the account holder's own profile). The scope always comes from `getContext` (server-side session), never from a request field. A foreign profile id is rejected.
- Child context audiences are `['kids','all']`: `/me` and the answer hook go through the same `Scope`; an `adults` item never appears for a child, in any list or in "answered" history.
- Permissions: `save_interests` already exists in `policy.ts` (allowed for pending teens too); add `save_answers` (allowed for confirmed 13-15, 16-17, 18+; NOT for consent-pending or under-13; a child profile may via `childCan`). Anonymous visitors save nothing and see the same play pages as today.
- Answers: store each profile's FIRST answer to an item only (`ON CONFLICT DO NOTHING`); store `correct` and `answered_at` (server time). No timers, no countdowns, no streaks, no leaderboards, no "you missed a day" wording (accessibility rule: no pressure mechanics).
- Child profile events are limited to answers and scores: no page views, no browsing history.
- Interests are references to existing topics (by id) and worlds (by id); at most 30 per profile; invalid ids rejected.
- The existing no-JS answer path keeps working unchanged for anonymous visitors; the Kids-page privacy e2e (no third-party requests, no storage identifiers) stays green. Saving an answer must not add any cookie or storage beyond the existing account cookie.
- The privacy page still says answers are not saved: that copy is rewritten before production go-live (existing gate in `docs/OPERATIONS.md`), not in this plan, but this plan must add the data-inventory rows.
- Migrations expand-only, rollback in the header. Commits have no AI trailers. TDD.

## Review Focus

- A child profile's `/me` never lists, counts or names an `adults` item, including through "answered" history or search-like interest matching.
- Profile A's interests or answers read through account B's session or a tampered profile id: denied.
- A consent-pending 13-15 account can save interests but answers are not stored.
- Answering the same item twice stores one row and the second attempt cannot change correctness.
- "Today" for an account in Pacific/Kiritimati or America/Los_Angeles is its own local day, not UTC.

---

### Task 1: Migration 010, interests and responses library, `save_answers`

**Files:**
- Create: `db/migrations/010_interests_responses.sql`, `lib/accounts/interests.ts`, `lib/accounts/responses.ts`
- Modify: `lib/accounts/policy.ts` (add `save_answers` to `Capability`, the matrix and the table tests)
- Test: `tests/unit/account-interests.test.ts`, `tests/unit/account-responses.test.ts`, extend `tests/unit/account-policy.test.ts`

**Interfaces:**
- Migration 010: `profile_interests (account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, profile_id uuid, topic_id int REFERENCES topics(id) ON DELETE CASCADE, world_id int REFERENCES worlds(id) ON DELETE CASCADE, CHECK (num_nonnulls(topic_id, world_id) = 1))` with a composite FK `(profile_id, account_id)` to `child_profiles (id, account_id)` `ON DELETE CASCADE` (child profiles exist with `UNIQUE (id, account_id)`), and unique indexes preventing duplicates (one for topics, one for worlds, using `COALESCE(profile_id, '00000000-0000-0000-0000-000000000000')`). `item_responses (account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, profile_id uuid (same composite FK, cascade), item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE, correct boolean NOT NULL, answered_at timestamptz NOT NULL)` with a unique index on `(account_id, COALESCE(profile_id, zero-uuid), item_id)` and an index on `(account_id, answered_at DESC)`. Check `items.id`'s real type in `001_core.sql` and match it. Rollback in the header.
- `type Owner = { accountId: string; profileId: string | null }`.
- `setInterests(db, owner: Owner, input: { topicIds: unknown; worldIds: unknown }): Promise<'ok' | 'invalid'>` (replace-all in one transaction; ids validated against `topics`/`worlds`; max 30 total; non-integer or duplicate input is `invalid`), `getInterests(db, owner): Promise<{ topicIds: number[]; worldIds: number[] }>`.
- `recordAnswer(db, owner: Owner, itemId: string, correct: boolean, now: Date): Promise<boolean>` (true if newly stored), `listAnswered(db, owner, page: { limit: number; offset: number }): Promise<{ itemId: string; correct: boolean; answeredAt: Date }[]>`, `countAnswered(db, owner): Promise<{ total: number; correct: number }>`.
- `can(group, consent, 'save_answers')` per the Global Constraints; `childCan('save_answers')` is true (extend the existing table test over every capability).

- [ ] **Step 1: Failing tests:** replace-all semantics; invalid ids, 31 ids, strings, duplicates -> `invalid` and nothing written; a foreign profile id (another account's) cannot be written or read (composite FK and code); `recordAnswer` first answer stored, second ignored, correctness unchanged; deleting a child profile removes its interests and responses; deleting the account removes everything; `save_answers` rows for every age group and consent state; policy table test covers the new capability.
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/account-interests.test.ts tests/unit/account-responses.test.ts tests/unit/account-policy.test.ts`
- [ ] **Step 3: Implement** (no Next.js imports in `lib/`).
- [ ] **Step 4: Run** the same plus `tests/unit/migrate*.test.ts` and the full unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: interests, saved answers and the save_answers capability`.

---

### Task 2: Session-derived scope on every public route (closes a 3C gap)

Today every public page and route uses `anonymousScope()`, which includes `adults`. A signed-in child context that opens an `adults` item by URL, or lists a world, topic, search or the home page, would therefore see `adults` items: that breaks `.claude/rules/data-isolation.md` ("a child profile never receives `adults` items on any route"). This task fixes it before any new feature relies on the scope.

**Files:**
- Create: `lib/accounts/scope.ts` (no Next imports: `scopeForSession(db, sessionToken: string | undefined, now: Date): Promise<Scope>`), `lib/accounts/scope-next.ts` (reads the account cookie via `next/headers` and calls it: `currentScope(): Promise<Scope>`)
- Modify: every caller of `anonymousScope()` that serves a person: `app/page.tsx`, `app/[world]/page.tsx`, `app/[world]/[slug]/page.tsx`, `app/topics/[slug]/page.tsx`, `app/quiz/page.tsx`, `app/quiz/archive/page.tsx`, `app/quiz/[id]/route.ts`, `app/search/page.tsx`, `app/api/template-image/[world]/[slug]/route.tsx`, `components/item/PlayPanel.tsx`, `app/report/[world]/[slug]/page.tsx` and its submit route. `app/sitemap.ts` stays anonymous (it is public indexing, never per person).
- Test: `tests/unit/account-scope.test.ts`, extend the existing public-reads test or add `tests/unit/public-scope-routes.test.ts`, extend `tests/e2e/accounts.spec.ts`

**Interfaces:**
- `scopeForSession`: no cookie, an invalid or expired session, or any error -> `anonymousScope(now)` (today's behaviour, fails to the anonymous scope, which is what a signed-out visitor has); a valid adult/teen session -> `anonymousScope`-equivalent `['kids','all','adults']` (from `getContext(...).audiences`); a child context -> `['kids','all']`.
- Behaviour must be identical for visitors with no account cookie: no new cookies or headers, same output (existing site, trust-pages and privacy e2e tests stay green). Pages that become cookie-aware must stay `force-dynamic` or become so, and none may be cached across users (check each page's `revalidate`/`dynamic` and any `unstable_cache`/ISR; the shared HTTP caching headers for these routes must be `private`/no-store when the account cookie is present).
- [ ] **Step 1: Failing tests:** `scopeForSession` for no cookie, garbage cookie, expired session, adult, teen, child (`['kids','all']` exactly); a child context requesting an `adults` item through `getPublicItem` with the session scope gets null; the list, topic, search, quiz and template-image reads with a child scope exclude `adults`; e2e: a child profile gets a 404 (not the item) for an `adults` item URL, its world page and search list no `adults` item, and the same URL works for an anonymous visitor.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** and replace the listed `anonymousScope()` calls with `await currentScope()` (route handlers use the request's cookies the same way).
- [ ] **Step 4: Run** unit suite, tsc, eslint, then after `npm run build` the combined e2e (`SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts --workers=1`, then `git checkout docs/screenshots`). Expected: PASS.
- [ ] **Step 5: Commit** `fix: public pages use the signed-in context's audiences, so a child profile never sees adults items`.

---

### Task 3: Record answers from the play panel

**Files:**
- Modify: `components/item/PlayPanel.tsx` (the only caller of `playResult`; it renders the result on a GET with the answer in the query string), `lib/play/answer.ts` only if a return value is needed (the item id)
- Test: `tests/unit/play-record.test.ts` (or extend the existing play tests), extend `tests/e2e/accounts.spec.ts`

**Interfaces:**
- Consumes: `getContext` (`lib/accounts/context.ts`), `currentScope` (Task 2), `can`/`childCan`, `recordAnswer` (Task 1), `playResult`.
- Behaviour: after a valid `ok` result, if the request carries an account session whose context allows `save_answers`, call `recordAnswer` for that context's owner (`profile?.id ?? null`). The scope given to `playResult` stays the context's audiences (child: `['kids','all']`); anonymous behaviour is byte-for-byte unchanged (no cookie read when the account cookie is absent; no new headers). A recording failure never changes the answer the visitor sees (log the error name only, no ids).
- [ ] **Step 1: Failing tests:** anonymous answer stores nothing and the response equals today's; a confirmed adult's answer stores one row for the account (profile NULL); a child context's answer stores for the profile id; a consent-pending 13-15 account's answer stores nothing; a recording error still returns the normal result; an `adults` item answered from a child context is not found and stores nothing.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** the hook as a small function in `lib/accounts/` (e.g. `recordIfSignedIn(db, request, item, result, now)`), keeping the route thin.
- [ ] **Step 4: E2E:** an adult signs in (as the existing spec does), answers a quiz, a row exists; anonymous answering a Kids item still passes the privacy test (no storage identifiers). Run the combined e2e from Task 3.
- [ ] **Step 5: Commit** `feat: save a signed-in profile's first answer to each item`.

---

### Task 4: Interests page and the `/me` dashboard

**Files:**
- Create: `app/me/page.tsx`, `app/me/interests/page.tsx`, `app/me/interests/save/route.ts`, `lib/accounts/dashboard.ts`
- Modify: `lib/accounts/next.ts` if a shared guard helps, `components/` for small shared pieces
- Test: `tests/unit/account-dashboard.test.ts`, extend `tests/e2e/accounts.spec.ts`

**Interfaces:**
- `dashboardFor(db, ctx: Context, now: Date): Promise<{ today: PublicItem[]; recent: PublicItem[]; answered: { item: PublicItem; correct: boolean; answeredAt: Date }[]; progress: { total: number; correct: number }; hasInterests: boolean }>` using `listPublic`/`getPublicItem` with `ctx.audiences` as the Scope. "Today" is the item published within the account's local calendar day (`accounts.time_zone`, fall back to UTC); recent is the last 14 local days, capped at 20 items. Items match when they are in a picked world or carry a picked topic.
- `/me`: requires a context (anonymous -> sign-in; child context allowed, adult-only actions are not offered). With no interests it shows a plain prompt to choose some. Progress is wording like "You have answered 12 items, 9 correct" with no streaks, no daily targets, no red warnings.
- `/me/interests`: checkboxes (worlds and topics, grouped, native fieldset/legend), POST to `save` (same-origin, flag guard, owner from `getContext`, `setInterests`), redirect with `?r=<code>#result` like the other pages. Child contexts can save their own interests (`childCan('save_interests')`); anonymous cannot.
- [ ] **Step 1: Failing unit tests:** the dashboard never contains an `adults` item for a child context; "today" for America/Los_Angeles and Pacific/Kiritimati accounts at a fixed clock; no-interest account sees `hasInterests=false`; an item answered by another profile of the same account is not shown; a foreign profile id in the form is ignored; the save route is same-origin only and 404 with the flag off.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.** Pages: WCAG 2.2 AA, labelled controls, noindex, 320px reflow, `#result` focus like the consent pages; no new cookies; no analytics.
- [ ] **Step 4: E2E:** an adult picks two interests, `/me` lists matching items and answered history; a child profile's `/me` lists no adults items; the page has no third-party requests; axe at 320px and desktop. Run `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts --workers=1` after `npm run build` (kill nothing unrelated; `git checkout docs/screenshots` afterwards).
- [ ] **Step 5: Commit** `feat: interests and the personal dashboard`.

---

### Task 5: Isolation tests, docs and tracker

- [x] **Step 1:** Add to `account-isolation.test.ts`: profile A's interests/answers via account B denied; child context `/me` data has no `adults` item; pending 13-15 stores no answers; tampered profile id ignored.
- [x] **Step 2:** `docs/OPERATIONS.md`: what interests and answers hold, first-answer-only rule, time-zone handling, deletion coverage (cascades), data-inventory rows (`profile_interests`, `item_responses`), migration 010 rollback pointer, reminder that the privacy page copy ("answers are not saved") is rewritten before go-live. Tracker item for 3.5/3.6.
- [x] **Step 3: Run** the full unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files.
- [x] **Step 4: Commit** `docs: interests and dashboard operations and isolation rows`.
