# Project 1B: Public Site from the Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock-up's file-based pages with a public site rendered from PostgreSQL (home, world, item, topic, search, sitemap, anonymous play, report a problem), verified on staging. Production keeps serving the static mock-up until the 1D cut-over.

**Architecture:** Pages are dynamic server components that call one read layer, `lib/public/` (no Next imports, unit-tested on PGlite), which requires an explicit audience scope on every read. Playing is server-rendered: the answer form is a plain GET form, the server checks the answer and renders the result, so nothing is sent early and no JavaScript is needed. Report-a-problem is a rate-limited POST that writes `problem_reports`, which 1C's admin will read.

**Tech Stack:** Next.js 16.4.2 (standalone, `trailingSlash: true`), React 19, `pg` via `lib/db.ts`, PGlite for unit tests, Playwright + axe for e2e, `next/og` (bundled with Next) for template images. One new dev dependency, `@electric-sql/pglite-socket`, pinned exactly (Task 1).

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md`, Project 1 (public site, images, playable items, cut-over inventory) and 4a.4 (report a problem). Tracker items 1.6, 1.7, 1.8.

## Scope and split (ruling)

The tracker's remaining Project 1 work (1.6–1.8, 1.12–1.19) is too large for one plan that ends in working software. Split:

- **1B (this plan):** 1.6 public site, 1.7 anonymous play, 1.8 report a problem, plus the 1A review's "public reads need an audience and world filter" minor.
- **1C (next plan):** 1.12 admin sign-in with second factor, 1.13 admin area (approval queue, reports, items, worlds, topics, agents), 1.14 worker service and daily digest, and the held-item `publish_at` fix from the review.
- **1D (after 1C):** 1.15 trust pages, 1.16 accessibility sign-off, 1.17 URL inventory and load test, 1.18 cut-over, 1.19 done-when.

**Non-goals for 1B:** accounts or child profiles (Project 3; anonymous scope only), page-view analytics (pilot project), admin UI, worker, trust-page rewrite, Caddy changes, importing into the production database, searching inside bodies, client-side quiz JavaScript.

## Global Constraints

- URL scheme is fixed: `/<world>/<slug>/`, `/topics/<slug>/`, English unprefixed; every URL ends in a slash (`trailingSlash: true`).
- Item URLs from the mock-up stay valid: `/discover/a-day-in-shadows/` etc. `/quiz/`, `/quiz/archive/` keep working; `/quiz/<id>/` redirects to the item's `/<world>/<slug>/` (Task 8).
- "No third-party requests, no trackers, no storage identifiers on Kids pages" (privacy e2e test) and the axe accessibility test are gates, never relaxed.
- WCAG 2.2 AA; native HTML first; every playable item answerable with no mouse and no JavaScript; reflow at 320px.
- Server-derived context is authoritative; every public read takes an explicit audience scope (no default); empty scope returns nothing.
- Routes stay thin (parse, call `lib/public/` or `lib/play/`, render). One concern per module. New code formatted normally (Prettier defaults), not in the mock-up's compressed style. No file near 2–3k lines.
- Items render only when `status = 'published'`, `published_at <= now`, world `enabled`, and `kind` is `article`, `quiz` or `game`. A `video_script` is never rendered on the site.
- Answers and explanations never appear in HTML, JSON-LD, flight data, search or sitemap before the player submits.
- Exact dependency pins (no `^`). Node 24.22.0. DB tests use `// @vitest-environment node`.
- Commits carry no AI co-author trailers. No push, deploy or live-server change without the owner's authorization for that action.

## Review Focus

1. **Answer leakage:** the explanation text, correct-answer marking or `answer` value reachable before submitting, through page HTML, the Next flight payload (`self.__next_f`), JSON-LD, search results or `og` data. Pinned in Task 7 (`play-leak.spec.ts`).
2. **Hidden content:** a `video_script`, a draft, scheduled, in_review or archived item, a future-dated item, or an item in a disabled world appearing on any page, list, search, sitemap, template image or answer check. Pinned in Tasks 3, 5, 7, 9.
3. **Hostile content:** titles or bodies containing `</script><script>`, markup, 140-character titles, and 300-character summaries breaking JSON-LD, layout at 320px, or escaping. Pinned in Tasks 6 and 7.
4. **Odd query input:** `?page=-1`, `?page=abc`, `?page=999999`, empty `q`, a 10,000-character `q`, and tsquery operators (`& | ! ( :*`) giving a graceful page, never a 500. Pinned in Tasks 3 and 9.
5. **Failure and empty states:** database down shows a generic error page with no internals; a world with no items and a database with no worlds each render an empty state rather than crashing. Pinned in Task 6.

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/e2e-db.ts` | Starts an in-process PostgreSQL on a socket for e2e, migrates, seeds, imports the starter content |
| `tests/e2e/helpers/fixtures.ts` | `addItem()` / `reset()` helpers that write extra items straight into the e2e database |
| `db/migrations/004_problem_reports.sql` | `problem_reports` table (additive) |
| `lib/public/scope.ts` | `Audience`, `Scope`, `ANONYMOUS_SCOPE()`, reserved world slugs |
| `lib/public/reads.ts` | All public item reads, required scope on each |
| `lib/public/worlds.ts` | `listWorlds`, `getWorld`, `getTopic` |
| `lib/public/jsonld.ts` | Article and breadcrumb JSON-LD, escaped; never emits quiz or game data |
| `lib/public/palette.ts`, `lib/public/template-image.tsx` | World colour keys to hex; the branded image renderer |
| `lib/play/check.ts` | Pure answer checking, describing and parsing per mechanic |
| `lib/play/answer.ts` | Loads item and stored answer, returns the result for a given response |
| `lib/reports/submit.ts` | Validates and stores a problem report; limiter |
| `app/[world]/…`, `app/topics/…`, `app/search/…`, `app/quiz/…`, `app/report/…`, `app/api/template-image/…` | Thin routes |
| `components/item/*` | One component per rendering concern (ArticleBody, VideoBlock, PlayForm, PlayResult, Sources, ReportLink) |

---

### Task 1: End-to-end database harness

**Files:**
- Create: `scripts/e2e-db.ts`, `tests/e2e/helpers/fixtures.ts`
- Modify: `playwright.config.ts`, `package.json` (dev dependency, script `e2e:db`)
- Reuse: the seeding and `importLegacy` calls from `scripts/import-starter-content.ts` (extract a shared function if the script has no importable one)

**Interfaces:**
- Produces: `E2E_DATABASE_URL = postgres://postgres@127.0.0.1:54329/postgres?sslmode=disable`; `addItem(over: Partial<ItemRow> & { world: string; slug: string }): Promise<string>` and `resetExtras(): Promise<void>` (deletes every item whose `created_by = 'e2e'`) in `tests/e2e/helpers/fixtures.ts`.

- [ ] **Step 1: Check the package and pin it.** Run `npm view @electric-sql/pglite-socket version peerDependencies` and install the version whose peer range matches the pinned `@electric-sql/pglite@0.5.14`, `--save-exact --save-dev`. Expected: install succeeds with no peer warning.
- [ ] **Step 2: Write `scripts/e2e-db.ts`.** Create a `PGlite`, run `migrate()`, seed worlds and topics, call `importLegacy` with the starter content, then start the socket server on 127.0.0.1:54329 and keep running; print `e2e db ready` once listening. Never reads `DATABASE_URL`, so it cannot touch a real database.
- [ ] **Step 3: Verify concurrency.** Run `npx tsx scripts/e2e-db.ts` in the background, then a one-off node script that opens `pg.Pool({max: 5})` against `E2E_DATABASE_URL` and runs five `select count(*) from items` in parallel. Expected: every result is 24 and `select count(*) from item_answers` is 14. If parallel queries fail, add `DB_POOL_MAX` to `lib/db.ts` (default 5, a test pins the default) and set it to 1 in the e2e server env; otherwise change nothing in `lib/db.ts`.
- [ ] **Step 4: Wire Playwright.** `webServer` becomes an array: first `npx tsx scripts/e2e-db.ts` (readiness: port 54329), then the existing `npm run preview` with `env: { DATABASE_URL: E2E_DATABASE_URL }`. `reuseExistingServer` stays `!process.env.CI`.
- [ ] **Step 5: Write `fixtures.ts`.** `addItem` inserts a published, auto-approved item by default (`status:'published'`, `published_at: now() - interval '1 minute'`, `created_by:'e2e'`, `risk_tier:'computable'`, `approved_by:'e2e'`), accepts overrides for `status`, `audience`, `kind`, `publish_at`, `published_at`, `body`, and a world `enabled` toggle helper; for playable kinds it also writes `item_answers`. It talks to `E2E_DATABASE_URL` with its own single connection.
- [ ] **Step 6: Run the existing e2e suite.** `npm run build:preview && npx playwright test`. Expected: same pass/fail as before this task (the pages still read files); the harness starts and stops cleanly.
- [ ] **Step 7: Commit** `test: in-process database for end-to-end tests`.

### Task 2: `problem_reports` migration

**Files:**
- Create: `db/migrations/004_problem_reports.sql`
- Test: `tests/unit/schema.test.ts` (new `describe('problem reports')`)

**Interfaces:**
- Produces: table `problem_reports(id bigserial PK, item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE, reason text NOT NULL CHECK (reason IN ('wrong','unsafe','broken','other')), message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 1000), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), created_at timestamptz NOT NULL DEFAULT now())` and index `problem_reports_status_created (status, created_at DESC)`. No reporter identity is stored.

- [ ] **Step 1: Write failing tests:** a valid insert succeeds; reason `'spam'` is rejected; a 1001-character message is rejected; deleting the item removes its reports; the table has no column naming an email, IP or user.
- [ ] **Step 2: Run** `npx vitest run tests/unit/schema.test.ts tests/unit/migrate-files.test.ts`. Expected: new tests FAIL (relation missing).
- [ ] **Step 3: Write the migration** (additive only; the contract-naming test must still pass).
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: problem_reports table`.

### Task 3: Public read layer with required audience scope

**Files:**
- Create: `lib/public/scope.ts`, `lib/public/reads.ts`, `lib/public/worlds.ts`
- Modify: `lib/items/repo.ts` (remove `getPublishedItem` and `listPublished`; keep `PublicItem`, `getAnswer`), `tests/unit/items-repo.test.ts` (move those tests to the new file)
- Test: `tests/unit/public-reads.test.ts`

**Interfaces:**
- Produces in `scope.ts`: `type Audience = 'kids'|'all'|'adults'`; `type Scope = { audiences: readonly Audience[]; now: Date }`; `anonymousScope(now = new Date()): Scope` (all three audiences, per the spec's "no age gate for anonymous visitors"); `RESERVED_WORLD_SLUGS: readonly string[]` (every top-level route name: `admin api about privacy terms accessibility contact editorial-policy quiz search topics me circles report community`).
- Produces in `reads.ts`: `getPublicItem(db: Queryable, scope: Scope, world: string, slug: string): Promise<PublicItem|null>`; `listPublic(db, scope, o: { world?: string; topic?: string; kind?: 'article'|'quiz'|'game'; limit: number; offset: number }): Promise<PublicItem[]>`; `searchPublic(db, scope, q: string, o: { limit: number; offset: number }): Promise<PublicItem[]>`; `listQuizzes(db, scope, o): Promise<PublicItem[]>` (newest first); `latestQuiz(db, scope): Promise<PublicItem|null>`.
- Produces in `worlds.ts`: `type World = { slug; name; promise; description; icon; color; sort }`; `listWorlds(db): Promise<World[]>` (enabled only, by `sort`); `getWorld(db, slug): Promise<World|null>`; `getTopic(db, slug): Promise<{ slug: string; name: string }|null>`.
- Every item read applies one shared predicate: published, `published_at <= scope.now`, world enabled, kind in (`article`,`quiz`,`game`), `audience = ANY(scope.audiences)`. No read has a default scope.

- [ ] **Step 1: Write failing tests** on PGlite, one fixture world each for enabled and disabled, covering: a published article is returned by all four reads; **child-like scope `['kids','all']` never receives an `adults` item from detail, list, topic list, search or latestQuiz**; empty `audiences` returns nothing from every read; `draft`, `scheduled`, `in_review`, `rejected`, `archived`, a `published_at` in the future, a `video_script`, and an item in a disabled world are each absent from every read; search ranks a title hit above a summary hit; search input `a & | ! ( b :*`, an empty string, 10,000 characters and `'; drop table items;--` return an array without throwing and without changing the table; `limit`/`offset` are honoured and `limit` above 50 is clamped to 50 and a negative offset to 0; `getTopic` unknown returns null; a seed-collision guard test asserts no seeded world slug is in `RESERVED_WORLD_SLUGS` and no directory name under `app/` that is a plain word (not a route group or `[param]`) equals a seeded world slug.
- [ ] **Step 2: Run** `npx vitest run tests/unit/public-reads.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules. Reuse `PUBLIC_SELECT` and `toPublic` from `repo.ts` (export them). Search uses `to_tsvector('english', i.title || ' ' || i.summary) @@ websearch_to_tsquery('english', $q)` so it hits the existing `items_search` index; rank with `ts_rank`; truncate `q` to 100 characters. Ruling: body text is not searched in 1B (YAGNI; the index exists only for title and summary).
- [ ] **Step 4: Run the new tests, then the whole suite.** Expected: PASS; no test still imports the removed functions.
- [ ] **Step 5: Commit** `feat: public read layer with required audience scope`.

### Task 4: Answer checking

**Files:**
- Create: `lib/play/check.ts`, `lib/play/answer.ts`
- Test: `tests/unit/play-check.test.ts`, `tests/unit/play-answer.test.ts`

**Interfaces:**
- Produces in `check.ts`: `parseGiven(mechanic: Mechanic, params: URLSearchParams, itemIds?: string[]): unknown | null` (null when the input is missing or malformed); `checkAnswer(mechanic: Mechanic, stored: unknown, given: unknown): boolean`; `describeAnswer(body: unknown, stored: unknown): string` (human text: the option text, `accepted[0]`, the number, or the ordered item texts).
- Produces in `answer.ts`: `type PlayResult = { status: 'ok'; correct: boolean; answerText: string; explanation: string } | { status: 'invalid' } | { status: 'not_found' }`; `playResult(db: Queryable, scope: Scope, world: string, slug: string, params: URLSearchParams): Promise<PlayResult>`.
- Form field contract (used by Task 7): `r` carries the response; `put_in_order` uses one field `pos-<itemId>` per item holding 1..n (every position used once); `clue_reveal` uses `clues=<n>` for how many clues are shown (default 1, clamped to the clue count).
- Normalisation: text answers are compared case-insensitively after trimming, collapsing whitespace and stripping punctuation; number answers are correct when `|given - value| <= tolerance`; input over 200 characters is invalid.

- [ ] **Step 1: Write failing tests** per mechanic with right, wrong and malformed input: multiple_choice (id), true_false (`'true'`/`'false'`), short_text (variants, case, trailing space, punctuation), number (inside, on and outside tolerance, `'abc'`, `'NaN'`, `'Infinity'`), odd_one_out, put_in_order (valid order, duplicate positions, missing position, unknown id), clue_reveal (accepted variants). `playResult`: returns `ok` with the explanation for a published quiz; `not_found` for a draft, a future-dated item, an article, a `video_script`, an unknown slug and a disabled world; `invalid` for missing params; an `adults` item with scope `['kids','all']` is `not_found`.
- [ ] **Step 2: Run both files.** Expected: FAIL.
- [ ] **Step 3: Implement.** `playResult` loads the item through `getPublicItem` (so every visibility rule applies), refuses any kind except `quiz`/`game`, then calls `getAnswer`. Never log the stored answer.
- [ ] **Step 4: Run both files.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: server-side answer checking for every launch mechanic`.

### Task 5: Branded template image

**Files:**
- Create: `lib/public/palette.ts`, `lib/public/template-image.tsx`, `app/api/template-image/[world]/[slug]/route.tsx`
- Test: `tests/unit/template-image.test.ts` (pure parts), `tests/e2e/template-image.spec.ts`

**Interfaces:**
- Produces: `worldHex(colorKey: string): string` (hex per world colour key, copied from the CSS variables in `app/globals.css`; unknown key returns the neutral brand colour); `wrapTitle(title: string, maxChars: number, maxLines: number): string[]` (breaks on spaces, ellipsis on overflow, a single word longer than `maxChars` is hard-split); `GET /api/template-image/<world>/<slug>/` returns a 1200×630 PNG.
- Rule: no external font or emoji fetch (Satori would call a CDN); use the bundled default font, and show the world name in a badge instead of the icon glyph (ruling: the icon column holds a symbol that may need an emoji font).

- [ ] **Step 1: Write failing tests.** Unit: `wrapTitle` with a 140-character title, a 60-character single word, empty string; `worldHex` known and unknown key. E2E (uses `addItem`): published item → 200, `content-type: image/png`, first bytes `89 50 4E 47`; a draft, a future-dated item, a `video_script` and an unknown slug → 404; `cache-control` is `public, max-age=86400`; the response makes no network request (assert via `page.on('request')` on a page embedding it that only localhost is hit).
- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement** with `ImageResponse` from `next/og`; the route reads through `getPublicItem(anonymousScope())` so the visibility rules apply.
- [ ] **Step 4: Run both** (`npm run build:preview` first for the e2e). Expected: PASS.
- [ ] **Step 5: Commit** `feat: branded template image for items`.

### Task 6: Layout, home, world and topic pages from the database

**Files:**
- Create: `app/[world]/page.tsx` (replaces `app/[brand]/page.tsx`), `app/topics/[slug]/page.tsx`, `app/error.tsx`, `components/item/ItemCard.tsx`, `lib/public/jsonld.ts`
- Modify: `app/layout.tsx` (server component loads `listWorlds`), `components/Header.tsx` and `Footer.tsx` (take `worlds: World[]` as props; keep behavior and the menu's keyboard handling), `components/BrandCard.tsx` (takes a `World`; the five launch worlds keep their art via `lib/config.ts` lookup, other worlds use a generic card), `app/page.tsx`, `app/not-found.tsx`, `app/sitemap.ts` stays until Task 9
- Test: `tests/unit/jsonld.test.ts`, `tests/e2e/public-browse.spec.ts`

**Interfaces:**
- Consumes: `listWorlds`, `getWorld`, `listPublic`, `getTopic`, `anonymousScope` (Task 3), template image route (Task 5).
- Produces: `articleLd(item: PublicItem, baseUrl: string): object` and `breadcrumbLd(...)` in `jsonld.ts`, output always passed through the existing `JsonLd` component's `<` escaping; **there is no function that emits `Quiz`, `Question` or answer data**.
- Pages are `export const dynamic = 'force-dynamic'` (the build must not need a database). World page paginates with `?page=` (12 per page): a non-integer, zero or negative page is page 1; a page past the end shows the last page's empty-state message with a link back, never a 500. A world not in `listWorlds` is `notFound()`.

- [ ] **Step 1: Write failing tests.** Unit: `articleLd` output for a title `</script><script>alert(1)</script>` contains no raw `</script>` after `JSON.stringify` + the component's escape; no export of `jsonld.ts` mentions quiz. E2E (`public-browse.spec.ts`): home lists the five worlds and the latest published items from the database; a fixture item added with `addItem` appears on home and its world page without rebuilding; world page shows an empty state for a world with no items (fixture world); `?page=-1`, `?page=abc` and `?page=999999` return 200; a disabled world 404s and disappears from the header; topic page lists only items with that topic; an item with a 140-character title and a 300-character summary causes no horizontal overflow at 320px; with the database stopped the page returns 500 with the generic error page and the response body contains neither `ECONNREFUSED` nor `postgres`; a fresh database with no worlds renders the home page.
- [ ] **Step 2: Run** `npm run build:preview && npx playwright test tests/e2e/public-browse.spec.ts` and the unit test. Expected: FAIL.
- [ ] **Step 3: Implement.** Port the mock-up markup from the current `app/page.tsx` and `app/[brand]/page.tsx`, replacing file reads with the read layer; keep every existing class name so `globals.css` is untouched. The hero and brand showcase stay as they are.
- [ ] **Step 4: Run both.** Expected: PASS. Also open `/`, a world page and a topic page at 320px and desktop and record what was seen.
- [ ] **Step 5: Commit** `feat: home, world and topic pages from the database`.

### Task 7: Item page and play

**Files:**
- Create: `app/[world]/[slug]/page.tsx` (replaces `app/[brand]/[slug]/page.tsx`), `components/item/ArticleBody.tsx`, `VideoBlock.tsx`, `Sources.tsx`, `PlayForm.tsx`, `PlayResult.tsx`
- Test: `tests/e2e/item-page.spec.ts`, `tests/e2e/play-leak.spec.ts`

**Interfaces:**
- Consumes: `getPublicItem`, `playResult`, `parseGiven`, `articleLd`, template image route. Search params `r`, `pos-<id>`, `clues` per Task 4's field contract.
- `PlayForm` renders a `<form method="get">` with one field set per mechanic: radios for multiple_choice, odd_one_out and true_false; a text input for short_text and clue_reveal; a `type="number" step="any"` input for number; one labelled `<select>` per item for put_in_order. clue_reveal shows the first `clues` clues and a "Show another clue" link that sets `clues=n+1`. The answer form and result are one server-rendered page; the result block has `role="status"`, shows right/wrong, the answer text and the explanation, and a "Try another" link.
- Articles keep the mock-up's rendering (sections, takeaway, byline, AI disclosure, correction note, Kids age guidance / materials / supervision / safety notes / screen-free extension, legacy video poster, transcript and production status). Sources render as links to the stored https URLs with `rel="noopener noreferrer"`. Every item page ends with a "Report a problem" link to `/report/<world>/<slug>/` (Task 10).

- [ ] **Step 1: Write failing e2e tests.** `item-page.spec.ts`: each starter article renders its h1 from the database; `/discover/a-day-in-shadows/` keeps its canonical URL and `og:image` pointing at the template image route; an item added with `<b>x</b>` in title and paragraph shows literal text, not markup; the Kids article shows its materials and supervision; a `video_script`, a draft and a future item return the not-found page; an `adults` item renders (anonymous scope). `play-leak.spec.ts`: for every starter quiz and one fixture of each mechanic, before answering the HTML (including `self.__next_f` payload), `og` tags and JSON-LD contain none of the explanation text, the string `correct`, or the `answer` value for non-choice mechanics; after submitting the right response the page shows "Correct" and the explanation; submitting a wrong response shows "Not quite", the answer text and the explanation; keyboard only (Tab, Space, Enter) completes a multiple-choice item; JavaScript disabled still works (reuse the no-JS context from the existing suite); axe has no serious or critical violations on an article, an unanswered quiz and an answered quiz.
- [ ] **Step 2: Run** `npm run build:preview && npx playwright test tests/e2e/item-page.spec.ts tests/e2e/play-leak.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and components; port the existing article renderer first, then the play components. Set `metadata` with `alternates.canonical`, `openGraph.images`, `robots: noindex` when `SITE_RELEASE === 'false'`.
- [ ] **Step 4: Run both specs.** Expected: PASS. Record the visual check at 320px and desktop for an article, a Kids article, an unanswered quiz and an answered quiz.
- [ ] **Step 5: Commit** `feat: item pages and server-rendered play`.

### Task 8: Quiz routes

**Files:**
- Modify: `app/quiz/page.tsx`, `app/quiz/archive/page.tsx`, `app/quiz/[id]/page.tsx`
- Delete: `components/Quiz.tsx`, `lib/quiz-date.ts` and their imports (after Step 4)
- Test: `tests/unit/public-reads.test.ts` (add `latestQuiz` boundary cases), `tests/e2e/quiz-routes.spec.ts`

**Interfaces:**
- `/quiz/` renders the latest published quiz as the item page does (shared component, canonical pointing at `/<world>/<slug>/`); with no published quiz it shows "No new quiz today" and a link to the archive. `/quiz/archive/` lists published quizzes newest first, paginated like Task 6. `/quiz/<id>/` is a permanent redirect to `/<world>/<slug>/` when a published quiz with that slug exists in any world, else not-found.

- [ ] **Step 1: Write failing tests.** Unit: `latestQuiz` with `now` one second before and one second after a quiz's `published_at` (before: previous quiz or null; after: the new one), and with two quizzes in one UTC day returns the later. E2E: `/quiz/` shows a prompt and answer form; `/quiz/archive/` links every published starter quiz; `/quiz/<starter id>/` answers 308 with `Location` ending in the item URL; an unknown id is 404; a draft quiz id is 404.
- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement.** Ruling: the old client-side UTC-midnight rollover test is replaced by the unit boundary test, because "today's quiz" is now decided on the server from `published_at`; the privacy and axe tests are unchanged.
- [ ] **Step 4: Run both, then delete the superseded client quiz files and run the type check.** Expected: PASS and no unused imports.
- [ ] **Step 5: Commit** `feat: quiz routes read from the database, old ids redirect`.

### Task 9: Search and sitemap

**Files:**
- Create: `app/search/page.tsx`
- Modify: `app/sitemap.ts`, `app/robots.ts` (only if it reads content files)
- Test: `tests/e2e/search.spec.ts`, `tests/unit/sitemap.test.ts` (pure builder)

**Interfaces:**
- `/search/?q=` is a GET form that works without JavaScript and shows up to 12 results per page with `?page=`; an empty or whitespace `q` shows the form and a hint, not an error; at most 100 characters of `q` are used and the page says so when it truncated. Results show title, summary and world, never the answer or explanation. The page is `noindex`.
- `buildSitemap(items: { world: string; slug: string; updatedAt: Date }[], worlds: string[], baseUrl: string): MetadataRoute.Sitemap` in `lib/public/sitemap.ts`; the route returns the empty list when `SITE_RELEASE === 'false'`. It lists static pages, enabled worlds, topics and published items only.

- [ ] **Step 1: Write failing tests.** Unit: the builder includes worlds and items with trailing slashes, and excludes nothing it was given (filtering is the read layer's job). E2E: a published fixture titled "Zebra crossing" is found by `q=zebra`; a draft titled "Zebra draft" is not; `q=` empty, `q=a%20%26%20%7C%20!%20(`, a 10,000-character `q`, `page=-1` and `page=abc` all return 200; results never contain explanation text; sitemap contains a published item and no draft or `video_script` slug, and is empty under `SITE_RELEASE=false`; keyboard-only search (type, Enter) works.
- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: search and sitemap from the database`.

### Task 10: Report a problem

**Files:**
- Create: `lib/reports/submit.ts`, `app/report/[world]/[slug]/page.tsx`, `app/report/[world]/[slug]/route.ts` (POST), `components/item/ReportLink.tsx`
- Test: `tests/unit/reports.test.ts`, `tests/e2e/report.spec.ts`

**Interfaces:**
- Produces: `submitReport(db: Queryable, scope: Scope, input: { world: string; slug: string; reason: unknown; message: unknown; website: unknown }): Promise<{ status: 'stored' } | { status: 'invalid' } | { status: 'not_found' }>`. `website` is a honeypot: when non-empty the function returns `stored` without writing. `reason` must be one of `wrong unsafe broken other`; `message` is trimmed and at most 1000 characters.
- Rate limiting: `createLimiter` from `lib/agents/rate-limit.ts` reused with a per-client limit of 5 reports per hour and a global limit of 200 per hour, keyed by the first entry of `X-Forwarded-For` (Caddy replaces any client-sent value, and the app listens only on loopback) falling back to `unknown`. Over the limit returns 429 with `Retry-After`.
- The POST route accepts `application/x-www-form-urlencoded`, checks the `Origin` header matches the request host when present (else 403), and answers with a 303 redirect to `/report/<world>/<slug>/?sent=1`. The form page works without JavaScript and shows a confirmation with `role="status"`.

- [ ] **Step 1: Write failing tests.** Unit: a valid report is stored for a published item; an unknown slug, a draft and a `video_script` are `not_found` and write nothing; bad reason and 1001-character message are `invalid`; a filled honeypot writes nothing; a message with markup is stored verbatim (output encoding is the reader's job); the sixth report from one client key in an hour is refused and a different key still succeeds. E2E: form submit from the item page lands a row in `problem_reports` and shows the confirmation; a POST with a foreign `Origin` is 403; the page passes axe and is completable by keyboard; the sixth rapid POST returns 429.
- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement** with the limiter instance created once per process in the module.
- [ ] **Step 4: Run both.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: report a problem`.

### Task 11: Retire the file-based pages and port the e2e gates

**Files:**
- Modify: `tests/e2e/site.spec.ts` (port, do not weaken), `lib/content.ts` (only importers left are the import scripts and `validate-content`), `package.json` if `build` still needs `content:validate`
- Delete: any remaining component or route that reads `lib/content.ts` for page rendering, `app/[brand]/` once empty

**Interfaces:**
- Consumes everything above. Produces a clean tree where no `app/` file imports `lib/content.ts`.

- [ ] **Step 1: Grep** `app` and `components` for `lib/content`, `allArticles`, `articles`, `quizzes`, `isBrand` imports. Expected: only files this task rewrites.
- [ ] **Step 2: Port the assertions** in `site.spec.ts` to run against the e2e database: home → Discover → article; mobile menu keyboard, Escape and focus; 320px reflow on `/`, `/kids/`, a Kids article and `/quiz/`; axe on `/`, `/kids/`, an article and an answered quiz; the Kids privacy test (no third-party request, no `localStorage`/`sessionStorage`, no cookies) over `/kids/`, a Kids article, `/quiz/` and a Kids quiz-or-article; no-JS article readability; metadata, canonical and noindex under `SITE_RELEASE=false`; screenshot evidence at 390 and 1440. Remove only the test steps for behavior that no longer exists (client UTC-midnight rollover, the dated static answer archive), and name them in the commit message.
- [ ] **Step 3: Run** `npm run lint && npm run typecheck && npx vitest run && npm run build:preview && npx playwright test`. Expected: all green, including the privacy and axe tests unmodified in intent.
- [ ] **Step 4: Delete** the superseded code and run Step 3 again.
- [ ] **Step 5: Commit** `refactor: remove file-based page rendering; e2e gates run on the database`.

### Task 12: Staging rollout and verification (owner authorization required)

**Files:**
- Modify: `docs/OPERATIONS.md` (new section "Public site (Project 1B)"), `docs/superpowers/plans/2026-10-30-roadmap-tracker.md` (mark 1.6–1.8 done for 1B; record the 1B/1C/1D split)

- [ ] **Step 1: Stop and ask the owner** to authorize pushing the `staging` branch (a push deploys staging). Do not push without a yes.
- [ ] **Step 2: After authorization**, push the branch to `staging`, then watch the Actions run and the receiver output. Expected: migrations 003 and 004 applied, release healthy at `/api/health/`.
- [ ] **Step 3: Verify on `https://staging.sparkkindly.com`** (basic auth from the owner's secrets file, never echoed): home lists the five worlds; one article per world renders; a Kids article renders; `/quiz/` answers right and wrong; `/search/?q=shadow` finds the starter article; a report submitted from an item lands in `problem_reports` (check with a count before and after through the existing SSH tunnel procedure, then delete the test row); template image returns PNG; sitemap is empty and robots disallows everything; `/api/health/` still `{ok:true}`; MyLuxVacation, `ufw` rules and the Caddyfiles unchanged; production service and database untouched.
- [ ] **Step 4: Record** the evidence in `docs/OPERATIONS.md` and update the tracker.
- [ ] **Step 5: Commit** `docs: Project 1B verified on staging`.

---

## Self-Review

**Spec coverage.** Home, world, item, topic pages: Tasks 6, 7. Full-text search: Task 9. Sitemap, robots, structured data: Tasks 6, 7, 9. Template images and image origin/licence kept in the stored `image` column: Task 5 (rendering) and Task 7 (stored `src` is path-only since the 1A fix). Generic game renderer for every launch mechanic, answers checked server-side, explained answers withheld until answering: Tasks 4, 7. Report a problem on every item, rate-limited, lands for the admin queue: Task 10 (queue UI is 1C). Rate limits: Task 10. URL scheme and preserved item URLs: Global Constraints, Tasks 6–8. Gaps by design: sign-in, admin, worker, digest, trust pages, accessibility sign-off, cut-over are 1C/1D.

**Type consistency.** `Scope`/`anonymousScope` (Task 3) are used unchanged in Tasks 4, 5, 6, 7, 10. `PlayResult` and the `r` / `pos-<id>` / `clues` field contract (Task 4) are the only inputs `PlayForm` (Task 7) emits. `World` (Task 3) is what `Header`, `Footer` and `BrandCard` take (Task 6). `addItem`/`resetExtras` (Task 1) are used by Tasks 5–10.

**Step scan and proportion.** Every step names files, signatures and the observable result; no step carries a function body the tests already determine.

**Review Focus coverage.** 1 → Task 7; 2 → Tasks 3, 5, 7, 9, 10; 3 → Tasks 6, 7; 4 → Tasks 3, 6, 9; 5 → Task 6.

## Rulings made while planning

- Split 1B from 1C and 1D (above); the owner can still ask for one combined plan.
- Search covers title and summary only, to use the index 1A already created; no new search migration.
- Playing is a GET form with the result rendered by the server, so no JavaScript is required and nothing is stored; cost if wrong: answers appear in the URL of the result page (harmless, they are the player's own guess).
- Template images omit the world icon glyph (emoji font would need a third-party fetch); cost if wrong: images are plainer until a font is bundled.
- `video_script` items are never rendered on the site; they exist for Project 5.
- The client UTC-rollover e2e test is retired because that behavior no longer exists; the privacy and axe gates stay.
