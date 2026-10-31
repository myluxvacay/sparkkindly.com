# Project 1A: Platform data core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PostgreSQL-backed content core: schema and migrations that run on every deploy, the 24 starter items imported on staging, a validated item format, server-side quality gates and the approval policy, and a key-protected agent API that moves an item from `draft` to `published`.

**Architecture:** Plain SQL migrations applied by a dependency-light runner that ships inside each release and runs through the receiver's `migrate.sh` hook. All data access goes through a small `Db` interface (`pg` in the app, in-process PGlite in tests, so tests run on Windows and CI with no database server). Business rules live in `lib/items/` and `lib/agents/` with no Next.js imports; route files only parse and respond.

**Tech Stack:** PostgreSQL 16, `pg` 8.23.1 (already installed), `@electric-sql/pglite` (test only, exact pin), zod 4.6.7 (existing), Vitest, Next.js 16.4.2 route handlers.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` — Project 1 (schema, publish API, quality gates, approval policy, starter content), section 4a.4 (risk tiers) and section 7a. This plan covers the first half of Project 1; the public site, admin, worker service, digest and cut-over are plan 1B.

## Global Constraints

- Node **24.22.0**; no Docker; Next.js 16.4.2; exact dependency versions, no `^`.
- **Items never reach `scheduled` or `published` unless the Kids rule is met** — enforced by a database `CHECK`, not only in code: an item with `risk_tier='kids'` or `audience='kids'` needs `approved_by IS NOT NULL` for those statuses.
- **A client can never set an item's `status`.** The agent API ignores any `status` field; the server decides it.
- **Answers are stored apart from item bodies** (`item_answers`) and no public read function selects them.
- Statuses: `draft`, `in_review`, `scheduled`, `published`, `rejected`, `archived`. Kinds: `article`, `game`, `quiz`, `video_script`, `puzzle`. Audiences: `kids`, `all`, `adults` (`adults` means "aimed at adults", not an age gate). Risk tiers: `excluded`, `sourced`, `computable`, `reflective`, `kids`. Approval modes per world: `auto`, `review`.
- Launch game mechanics (one generic renderer, answer-based): `multiple_choice`, `true_false`, `short_text`, `number`, `odd_one_out`, `put_in_order`, `clue_reveal`. Anything else is rejected.
- Slug regex `^[a-z0-9-]+$`; unique per `(world, locale)`. Locale `en` only for now.
- Agent keys: format `skagt_<8 hex>_<48 hex>`; only `sha256(secret)` and the 8-hex prefix are stored; compared with `timingSafeEqual`.
- Migrations are **expand-then-contract**: a release must run against the schema of the next one. Each migration runs in a transaction under `pg_advisory_lock(7263001)`.
- The **production database is not touched in this plan**: starter content is imported on **staging only**. Importing to production happens at the Project 1B cut-over, and only after backups (Project 0 tasks 0.9–0.10, deferred by the owner) exist.
- Commits follow `.claude/rules/git.md` (no AI co-author trailers). Pushing `staging` deploys staging; pushing `main` deploys production and waits for the independent review.

## Methodology

Executed under `AGENTS.md`. **High-risk:** Tasks 1, 2, 3 (schema, migrations, data import), 6 and 7 (quality gates and approval policy protect child safety), 8 (agent keys and API), 10 (deploy-time migration). **Standard:** Tasks 4, 5, 9. High-risk tasks get an independent review before merge; the reviewer re-runs the Review Focus tests below.

## Review Focus

1. **Replayed submissions must not duplicate.** The same idempotency key from the same agent returns the same item and creates no second row (Task 8).
2. **A Kids item can never be scheduled or published without owner approval**, whether through the API, the policy function, or a direct SQL update (Tasks 2, 7, 8).
3. **Answers never leak.** No public read function returns `item_answers`, and the quiz body stored on `items` contains no correct-answer field (Tasks 3, 5).
4. **Agent keys are scoped and revocable.** Agent A cannot read or write agent B's world; a disabled or wrong key is rejected; a key is never logged or stored in clear (Task 8).
5. **Migrations are safe to repeat and to race.** Running the runner twice changes nothing; two concurrent runners do not both apply a migration (Task 1).

---

### Task 1: Database interface and migration runner

**Files:**
- Modify: `lib/db.ts` (add `Db` and `getDb`)
- Create: `db/migrate.mjs`, `db/migrate.d.mts`, `db/migrations/000_init.sql` (creates nothing but proves the runner; real schema in Task 2)
- Create: `tests/helpers/test-db.ts`
- Test: `tests/unit/migrate.test.ts`
- Modify: `package.json` (devDependency `@electric-sql/pglite`, exact pin; script `db:migrate`)

**Interfaces:**
- Produces in `lib/db.ts`: `interface Db { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> }` and `getDb(): Db` (wraps `getPool()`).
- Produces in `db/migrate.mjs`: `migrate(db: Db, dir: string): Promise<{ applied: string[] }>`. Reads `dir/*.sql` in filename order, skips names already in `schema_migrations(name text primary key, applied_at timestamptz)`, applies each inside `BEGIN … COMMIT`, takes `pg_advisory_lock(7263001)` for the whole run and releases it in `finally`. CLI: `node db/migrate.mjs` reads `DATABASE_URL`, runs `db/migrations`, prints applied names.
- Produces in `tests/helpers/test-db.ts`: `newTestDb(): Promise<Db & { close(): Promise<void> }>` — a fresh in-process PGlite instance, already migrated through `db/migrations`.

- [ ] **Step 1: Write the failing tests** (`migrate.test.ts`, using PGlite directly, not `newTestDb`): `applies pending migrations in filename order` (two temp migration files, assert both names returned in order); `a second run applies nothing` (`applied` is `[]`); `a failing migration rolls back and is not recorded` (file with `CREATE TABLE a(); SELECT 1/0;` → rejects; table `a` absent; name not in `schema_migrations`); `two concurrent runners apply each migration exactly once` (`Promise.all` of two `migrate` calls over one migration that inserts a row into a log table; log table has exactly 1 row).
- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/migrate.test.ts` → FAIL, cannot resolve `db/migrate.mjs`.
- [ ] **Step 3: Implement** `db/migrate.mjs` (plain ESM, no imports except Node built-ins; takes the `Db` as a parameter) and `Db`/`getDb`. For PGlite concurrency, wrap the lock acquisition in the runner (`pg_advisory_lock` is a no-op-safe call in PGlite; if PGlite serialises queries on one connection the concurrent test still passes by the `schema_migrations` primary key — the runner must tolerate a unique-violation on insert by re-checking applied names). Add `@electric-sql/pglite` with `npm install --save-dev --save-exact`.
- [ ] **Step 4: Verify** — `npx vitest run tests/unit/migrate.test.ts` → 4 passed; then `npm run lint && npm run typecheck && npm test -- --run` green.
- [ ] **Step 5: Commit** — `git add lib/db.ts db tests/helpers tests/unit/migrate.test.ts package.json package-lock.json && git commit -m "feat: migration runner and a Db interface testable without a server"`.

---

### Task 2: Core schema migration

**Files:**
- Create: `db/migrations/001_core.sql`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Produces tables (names and columns later tasks rely on):
  - `worlds(id serial pk, slug text unique not null, name text not null, promise text, description text, icon text, color text, sort int not null default 0, enabled bool not null default true, approval_mode text not null default 'auto' check in ('auto','review'), buffer_days int not null default 3, goals text)`
  - `topics(id serial pk, slug text unique not null, name text not null, parent_id int references topics)`
  - `items(id uuid pk default gen_random_uuid(), world_id int not null references worlds, kind text not null check …, slug text not null, locale text not null default 'en', title text not null, summary text not null, body jsonb not null, audience text not null check …, evergreen bool not null default false, status text not null default 'draft' check …, publish_at timestamptz, published_at timestamptz, created_by text not null, agent_id int references agents, risk_tier text not null check …, sources jsonb not null default '[]', quality_report jsonb not null default '{}', image jsonb not null default '{}', approved_by text, approved_at timestamptz, idempotency_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (world_id, locale, slug), unique (agent_id, idempotency_key))`
  - **`CHECK` on `items`**: `(risk_tier <> 'kids' AND audience <> 'kids') OR status NOT IN ('scheduled','published') OR approved_by IS NOT NULL`
  - `item_topics(item_id uuid references items on delete cascade, topic_id int references topics, primary key (item_id, topic_id))`
  - `item_answers(item_id uuid primary key references items on delete cascade, answer jsonb not null, explanation text not null)`
  - `item_revisions(id bigserial pk, item_id uuid references items on delete cascade, revision int not null, snapshot jsonb not null, changed_by text not null, reason text, created_at timestamptz not null default now(), unique (item_id, revision))`
  - `events(id bigserial pk, at timestamptz not null default now(), name text not null, profile_id uuid, meta jsonb not null default '{}')`
  - `agents(id serial pk, name text unique not null, world_id int references worlds, key_prefix text unique not null, key_hash text not null, enabled bool not null default true, last_run_at timestamptz, created_at timestamptz not null default now())` (created before `items` in the file)
  - `audit_log(id bigserial pk, at timestamptz not null default now(), actor text not null, action text not null, target text, detail jsonb not null default '{}')`
  - `sponsors(id serial pk, name text not null, link text not null, logo text, disclosure text not null, active_from date, active_to date)`, `sponsorships(id serial pk, sponsor_id int references sponsors, world_id int references worlds, topic_id int references topics, item_id uuid references items, label text not null, click_count int not null default 0, starts_on date, ends_on date, check (num_nonnulls(world_id, topic_id, item_id) = 1))`
  - `failed_jobs(id bigserial pk, job text not null, payload jsonb not null default '{}', error text not null, attempts int not null default 1, at timestamptz not null default now())`
  - indexes: `items(status, publish_at)`, `items(world_id, status, published_at desc)`, `item_topics(topic_id)`, a GIN full-text index on `to_tsvector('english', title || ' ' || summary)` for Project 1B search.

- [ ] **Step 1: Write the failing tests** (`schema.test.ts`, using `newTestDb()`): `rejects an unknown status`, `rejects an unknown audience and risk tier and kind`, `(world, locale, slug) is unique`, `(agent, idempotency key) is unique`, **`a Kids item cannot be scheduled without approved_by`** (insert kids item `draft` ok; `UPDATE … SET status='scheduled'` → rejects with check violation; with `approved_by='owner'` → ok), **`an audience kids item cannot be published without approved_by`**, `a non-Kids item can be scheduled without approval`, `deleting an item removes its answers, topics and revisions`, `a sponsorship must target exactly one of world, topic, item`.
- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/schema.test.ts` → FAIL (tables do not exist).
- [ ] **Step 3: Implement** `001_core.sql` as specified (one transaction by the runner; use `IF NOT EXISTS` nowhere — the runner guarantees once).
- [ ] **Step 4: Verify** — schema test all pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: core schema with a database-level Kids approval guarantee"`.

---

### Task 3: Seed data and starter-content import

**Files:**
- Create: `db/seed/worlds.ts` (five worlds from `lib/config.ts` brands: name, promise, description, icon, color, sort order play, discover, together, grow, kids; `approval_mode` `review` for `kids`, `auto` for the rest), `db/seed/topics.ts` (initial curated topic list: about 40 topics grouped under parents such as science, nature, maths-and-logic, relationships, family, motivation, money-habits, wellbeing, creativity, language, history, technology, kindness, play-and-games)
- Create: `lib/items/import-legacy.ts`, `scripts/import-starter-content.ts` (CLI; reads `content/articles/*.json` and `content/quizzes/*.json`; refuses to run if `DATABASE_URL` host/db is the production database unless `--allow-production`), `package.json` script `content:import`
- Test: `tests/unit/import-legacy.test.ts`

**Interfaces:**
- Consumes: `articleSchema`, `quizSchema` from `lib/schemas.ts`; `Db`; `migrate`.
- Produces: `seedReference(db: Db): Promise<void>` (idempotent upserts of worlds and topics); `importLegacy(db: Db, articles: Article[], quizzes: Quiz[]): Promise<{ items: number; answers: number }>` (idempotent: re-running changes nothing). Mapping: article → `kind='article'`, quiz → `kind='quiz'`; `brand` → world; `audience` `kids` for the Kids world, `all` otherwise; `risk_tier` `kids` for Kids world, `sourced` for articles/quizzes with sources, `computable` for quizzes without sources whose brand is `play`, `reflective` for the rest; `status='published'` for `reviewStatus='approved'` with `approved_by='SparkKindly site owner'`; `published_at` from `publishedAt` or the quiz `scheduledDate`; `sources` copied; `image` = `{origin:'unsplash'|'owner-supplied' by manifest, licence, src}` from the article `hero` (credit/rights strings preserved); quiz body = `{mechanic:'multiple_choice', prompt, options:[{id,text}], difficulty, scheduledDate}` **without** the correct answer; the correct option id and explanation go to `item_answers`; tags map to topics by slug where one exists.

- [ ] **Step 1: Write the failing tests:** `seedReference creates five worlds with Kids in review mode`, `seedReference is idempotent` (twice → same counts), `imports 10 articles and 14 quizzes as 24 published items` (real files from `content/`), `every imported item has a world, an audience and a risk tier`, **`no quiz item body contains the correct answer`** (assert the stored `body` JSON has no `correctOptionId` key and `item_answers` has 14 rows), `kids articles are audience kids and tier kids and carry approved_by` (check constraint satisfied), `re-running the import changes no row count`, `image origin and licence are recorded for every article`.
- [ ] **Step 2: Run to verify failure** — FAIL (modules missing).
- [ ] **Step 3: Implement** seeds, `importLegacy`, the CLI, and the production guard (CLI exits 2 with a message when `current_database()` is `sparkkindly` and the flag is absent).
- [ ] **Step 4: Verify** — tests pass; run the CLI against a PGlite dump is not needed here; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: seed worlds and topics, import starter content with answers stored apart"`.

---

### Task 4: Item format (per-kind schemas)

**Files:**
- Create: `lib/items/format.ts`, `docs/item-format.md`
- Test: `tests/unit/item-format.test.ts`

**Interfaces:**
- Produces: `mechanics = ['multiple_choice','true_false','short_text','number','odd_one_out','put_in_order','clue_reveal'] as const`; `itemSubmissionSchema` (zod discriminated union on `kind`) validating the agent-facing submission `{ kind, world?, slug, title, summary, audience, evergreen?, topics: string[], sources: {title,url,accessedAt}[], image?, publishAt?, idempotencyKey, body }` where `body` is per kind: `article` `{ sections: {heading, paragraphs: string[]}[] (min 2), takeaway }`; `quiz`/`game` `{ mechanic, prompt, options?, items?, clues?, difficulty }` plus a separate `answer` object `{ answer, explanation }` required for quiz and game (never inside `body`); `video_script` `{ hook, beats: {voiceover, onScreenText, visual}[], captions, hashtags: string[] }`. Exports `type ItemSubmission`, `splitAnswer(submission): { body, answer }`.
- Per-mechanic rules (all in the schema): `multiple_choice` exactly 4 distinct options and the answer one of them; `true_false` answer boolean; `short_text` answer `{accepted: string[] (min 1)}`; `number` answer `{value:number, tolerance:number >= 0}`; `odd_one_out` 4 items, answer one of them; `put_in_order` 3–6 items, answer a permutation of item ids; `clue_reveal` 3–6 clues, answer `{accepted: string[]}`.

- [ ] **Step 1: Write the failing tests:** one accepting fixture and one rejecting fixture per kind and per mechanic (names: `accepts a valid multiple_choice quiz`, `rejects multiple_choice with a duplicate option`, `rejects an answer that is not one of the options`, `accepts number with tolerance`, `rejects a negative tolerance`, `rejects put_in_order whose answer is not a permutation`, `rejects an unknown mechanic`, `rejects an article with fewer than two sections`, `rejects a slug with capitals`, `splitAnswer removes the answer from the body` (body JSON has no `answer` key), `rejects a non-https source url`, `rejects an unknown audience`).
- [ ] **Step 2: Run to verify failure** — FAIL (module missing).
- [ ] **Step 3: Implement** `format.ts` and write `docs/item-format.md` (one example submission per kind, mechanic table, the rule that answers travel beside the body).
- [ ] **Step 4: Verify** — tests pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: item format with per-kind and per-mechanic validation"`.

---

### Task 5: Item repository

**Files:**
- Create: `lib/items/repo.ts`
- Test: `tests/unit/items-repo.test.ts`

**Interfaces:**
- Produces: `allowedTransitions: Record<Status, Status[]>` (draft→in_review|scheduled|rejected|archived; in_review→scheduled|rejected|draft; scheduled→published|draft|archived; published→archived; rejected→draft; archived→draft); `createItem(db, input: NewItem): Promise<StoredItem>` (inserts item, topics by slug (unknown slug → `UnknownTopicError`), answer row, first revision); `transition(db, id, to: Status, by: string, reason?: string, approval?: {by: string}): Promise<StoredItem>` (rejects a disallowed move with `IllegalTransitionError`; sets `published_at` on first publish; sets `approved_by/approved_at` when `approval` given; writes a revision; keeps only the **10 newest revisions**); `getPublishedItem(db, worldSlug, slug): Promise<PublicItem | null>` and `listPublished(db, opts: {world?: string; limit: number; offset: number}): Promise<PublicItem[]>` — **these never select `item_answers`**; `getAnswer(db, itemId): Promise<{answer, explanation} | null>` (the only reader of answers; used for server-side checking in plan 1B). `PublicItem` has no answer field by type.

- [ ] **Step 1: Write the failing tests:** `createItem stores the topics, the answer row and revision 1`, `createItem rejects an unknown topic`, `transition follows the allowed map` (each legal move succeeds), `transition rejects published to draft` (IllegalTransitionError), `first publish sets published_at once`, `only the 10 newest revisions are kept` (12 transitions → 10 rows, lowest revision 3), **`getPublishedItem returns no answer data`** (result JSON has no `answer` or `correct` key even for a quiz), `listPublished hides everything that is not published`, **`a Kids item cannot be transitioned to scheduled without approval`** (the DB check surfaces as `ApprovalRequiredError`), `with approval the same transition succeeds and records approved_by`.
- [ ] **Step 2: Run to verify failure** — FAIL (module missing).
- [ ] **Step 3: Implement** with parameterised SQL only; map the Postgres check-violation (`23514`) on the Kids constraint to `ApprovalRequiredError`; revision pruning inside the same transaction as the change.
- [ ] **Step 4: Verify** — tests pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: item repository with legal status moves, revision cap and answer-free reads"`.

---

### Task 6: Quality gates

**Files:**
- Create: `lib/items/gates.ts`, `lib/items/blocked.ts` (blocked words and Excluded-tier topic patterns: medical or health advice, legal advice, personal financial advice, self-harm, sexual content, violence, real private individuals; plus a profanity list), `lib/items/readability.ts`
- Test: `tests/unit/gates.test.ts`

**Interfaces:**
- Consumes: `ItemSubmission`, `Db`.
- Produces: `type GateResult = { gate: string; ok: boolean; reason?: string }`; `runGates(db: Db, sub: ItemSubmission, deps?: { fetch?: typeof fetch; now?: Date }): Promise<{ ok: boolean; results: GateResult[] }>` running, in order: `schema` (re-parse), `duplicate` (same `(world, locale, slug)` already exists, or a title with Jaccard word-set similarity ≥ 0.8 to any item created in the last 90 days in the same world), `blocked-words`, `blocked-topics` (Excluded tier), `sources` (required non-empty for `risk_tier` sourced; each URL fetched once with a 5 s timeout, `HEAD` then `GET`, must return 2xx; injected `fetch` in tests; sources are untrusted data, never executed), `kids-readability` (Kids audience only: Flesch–Kincaid grade of all prose ≤ 6), `explained-answer` (quiz/game must have a non-empty `explanation`). `riskTierFor(sub): RiskTier` derives the tier: kids audience or world `kids` → `kids`; any factual-claims submission with sources or kind article in discover → `sourced`; quiz/game with a computable mechanic (`number`, `put_in_order`) and no sources → `computable`; otherwise `reflective`. `fleschKincaidGrade(text: string): number` in `readability.ts`.

- [ ] **Step 1: Write the failing tests:** one failing and one passing case per gate (`duplicate: same slug in the same world fails`, `duplicate: a near-identical title in the last 90 days fails`, `duplicate: the same title 91 days ago passes`, `blocked-words: a listed word fails`, `blocked-topics: medical advice phrasing fails`, `sources: sourced tier with none fails`, `sources: an unreachable url fails`, `sources: all urls 200 passes`, `sources: a source url is only fetched, never followed beyond 3 redirects` (fetch stub counts), `kids-readability: grade 4 text passes and grade 10 text fails`, `explained-answer: a quiz without explanation fails`), `fleschKincaidGrade of a known sentence equals the expected value to one decimal`, `riskTierFor maps kids, sourced, computable and reflective`, and `runGates returns every gate result and ok only when all pass`.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement.** Similarity is word-set Jaccard in JS (no extension needed); fetch with `AbortSignal.timeout(5000)`; no gate throws: a thrown error becomes a failing `GateResult`.
- [ ] **Step 4: Verify** — tests pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: server-side quality gates including Kids readability and source checks"`.

---

### Task 7: Approval policy

**Files:**
- Create: `lib/items/policy.ts`
- Test: `tests/unit/policy.test.ts`

**Interfaces:**
- Produces: `decideStatus(input: { gatesOk: boolean; audience: Audience; riskTier: RiskTier; worldApprovalMode: 'auto' | 'review'; publishAt: Date | null; now: Date }): { status: 'draft' | 'in_review' | 'scheduled'; publishAt: Date | null; reason: string }`. Rules: gates failed → `draft`; `riskTier` `kids` or audience `kids` → `in_review` (always, even if the world is `auto`); world `review` → `in_review`; otherwise `scheduled` with `publishAt` = the given date or **next 06:00 UTC slot after the latest already-scheduled item for that world** (`nextSlot(db, worldId, now)` helper in the same file so the buffer fills one day at a time); `excluded` tier → `draft` with reason `excluded topic`.

- [ ] **Step 1: Write the failing tests:** `failed gates stay draft`, **`a Kids item goes to in_review even when the world is auto`**, **`audience kids goes to in_review`**, `a review-mode world sends everything to in_review`, `an auto world with passing gates schedules`, `excluded tier is never scheduled`, `nextSlot returns tomorrow 06:00 UTC for an empty world`, `nextSlot returns the day after the latest scheduled item`, `an explicit publishAt in the past is bumped to the next slot`.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** (pure function plus `nextSlot` using one parameterised query).
- [ ] **Step 4: Verify** — tests pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: approval policy with Kids always in review"`.

---

### Task 8: Agent keys and the publish API

**Files:**
- Create: `lib/agents/keys.ts`, `lib/agents/auth.ts`, `lib/agents/rate-limit.ts`, `lib/agents/api.ts`, `scripts/create-agent.ts`
- Create: `app/api/agent/brief/route.ts`, `app/api/agent/items/route.ts`, `app/api/agent/items/[id]/route.ts`
- Modify: `package.json` (script `agent:create`)
- Test: `tests/unit/agent-keys.test.ts`, `tests/unit/agent-api.test.ts`

**Interfaces:**
- Produces in `keys.ts`: `generateKey(): { key: string; prefix: string; hash: string }` (`key` = `skagt_<prefix>_<secret>`), `hashSecret(secret: string): string` (sha256 hex), `parseKey(key: string): { prefix: string; secret: string } | null`.
- Produces in `auth.ts`: `authenticate(db: Db, header: string | null): Promise<Agent | null>` (looks up by prefix, `timingSafeEqual` on hashes, rejects disabled agents, updates `last_run_at` at most once a minute).
- Produces in `rate-limit.ts`: `createLimiter(opts: { perMinute: number; now?: () => number }): (key: string) => boolean`. In-memory token bucket, 60 per minute per agent — **`// ponytail:` single-process limiter; move to the database if the app ever runs more than one instance.**
- Produces in `api.ts` (framework-free handlers taking `(db, agent, body|params)` and returning `{ status: number; json: unknown }`): `getBrief(db, agent)` → `{ today, world: {slug, goals, approvalMode, bufferDays}, supported: {kinds, mechanics}, topics: {slug, name, recentCount}[], recentTitles: string[30], scheduledDaysAhead: number }` (a world-less master agent must pass `?world=slug`); `submitItem(db, agent, body, deps?)` → validates with `itemSubmissionSchema`, **ignores any `status` field**, resolves the world (agent's own, or body `world` for the master), **rejects a world other than the agent's own with 403**, returns the existing item for a repeated `(agent, idempotencyKey)` (HTTP 200) or creates it (HTTP 201) after `runGates` + `riskTierFor` + `decideStatus`, storing the `quality_report`; `getItemStatus(db, agent, id)` → `{ id, status, qualityReport }` only for items created by that agent's world.
- Route files parse JSON, call `authenticate` (401 on failure), apply the limiter (429), call the handler, and return `Response.json`. Responses never include another agent's data, hashes or stack traces.
- `scripts/create-agent.ts <name> [--world slug]` prints the key **once** and inserts the hash.

- [ ] **Step 1: Write the failing tests:** keys: `generateKey produces the documented format`, `parseKey round-trips and rejects junk`, `only the prefix and hash are derivable from storage` (hash ≠ secret); api: **`replaying the same idempotency key returns the same item and creates no second row`** (Review Focus 1), **`a client-supplied status is ignored`** (submit with `status:'published'` → stored status is what policy decides), **`a Kids submission lands in in_review and cannot be scheduled by the API`** (Review Focus 2), `a passing Play submission is scheduled with a publish_at`, `a failing submission is stored as draft with the failing gate in the quality report`, **`agent A cannot submit to agent B's world`** (403) and **`agent A cannot read agent B's item status`** (404) (Review Focus 4), `a disabled agent is rejected`, `a wrong secret with a right prefix is rejected`, `the brief lists topics with recent counts, the last 30 titles and days of buffer`, `the brief hides other worlds`, `the 61st request in a minute is limited`, `no response body contains the key hash`.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** the modules and thin routes; every query parameterised; route files import handlers only.
- [ ] **Step 4: Verify** — tests pass; full suite green; `npm run build` succeeds (the routes compile).
- [ ] **Step 5: Commit** — `git commit -m "feat: scoped agent keys and the publish API with idempotent submissions"`.

---

### Task 9: Publish-due job

**Files:**
- Create: `lib/jobs/publish-due.ts`, `lib/jobs/run-job.ts`
- Test: `tests/unit/publish-due.test.ts`

**Interfaces:**
- Produces: `publishDue(db: Db, now: Date): Promise<{ published: string[] }>` — in one transaction selects `scheduled` items with `publish_at <= now` using `FOR UPDATE SKIP LOCKED`, moves each to `published` via `transition(... 'system')`, records an `events` row `item_published`. `runJob(db: Db, name: string, fn: () => Promise<unknown>, opts?: { attempts?: number; delayMs?: number }): Promise<void>` retries `attempts` (default 3) times with increasing delay and, if all fail, inserts a `failed_jobs` row (`error` message only, no stack) and rethrows nothing (the worker must keep running).

- [ ] **Step 1: Write the failing tests:** `publishes only items that are due`, `publishes a due item once even when called twice`, `two concurrent calls never publish the same item twice`, **`a Kids item in scheduled state without approval cannot exist, so none is published`** (assert the table cannot hold one), `runJob retries then succeeds`, `runJob records a failed_jobs row after the last failure and does not throw`, `failed_jobs error contains no stack trace`.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — tests pass; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: idempotent publish-due job with retry and dead-letter rows"`.

---

### Task 10: Deploy-time migration and staging rollout

**Files:**
- Create: `deploy/migrate.sh` (copied into each release as `migrate.sh`; `#!/usr/bin/env bash`, `exec /opt/sparkkindly/node/bin/node db/migrate.mjs`)
- Modify: `.github/workflows/deploy.yml` (the "Assemble release" step also copies `db/` and `deploy/migrate.sh` to `release/` and marks `migrate.sh` executable)
- Modify: `docs/OPERATIONS.md` (migrations: how they run on deploy, the expand-then-contract rule, how to run by hand, how to import starter content on staging), `docs/item-format.md` link
- Test: `tests/unit/migrate-files.test.ts`

**Interfaces:**
- Consumes: the receiver's migration hook (`deploy-receive.sh` runs `./migrate.sh` from the new release with the environment file sourced; a failure keeps the old release serving).
- Produces: every deploy applies pending migrations before the switch. The receiver and CI are unchanged apart from the assemble step.

- [ ] **Step 1: Write the failing test** (`migrate-files.test.ts`): `every migration file name matches NNN_snake_case.sql with strictly increasing numbers`, `no migration drops a table or column (expand-then-contract)` (grep for `DROP TABLE`/`DROP COLUMN` outside a file whose name contains `contract`), `deploy/migrate.sh is executable-shaped and runs db/migrate.mjs`.
- [ ] **Step 2: Run to verify failure** — FAIL (`deploy/migrate.sh` missing).
- [ ] **Step 3: Implement** the script, the workflow change and the docs.
- [ ] **Step 4: Verify locally** — tests pass; full suite green; `npm run build`; assemble a release locally as in Project 0 Task 5 Step 3 plus `db/` and `migrate.sh`, confirm `release/migrate.sh` and `release/db/migrations/001_core.sql` exist.
- [ ] **Step 5: Deliver to staging by hand and verify** — deliver the tarball with the staging key (`cmd /c "ssh -i … sparkkindly-staging@2.25.121.2 deploy < release.tgz"`). Expected: `Healthy: staging <sha7>`; then run on the VM as root: `runuser -u sparkkindly-staging -- env $(cat /opt/sparkkindly/shared/staging.env | xargs) /opt/sparkkindly/node/bin/node /opt/sparkkindly-staging/current/db/migrate.mjs` prints no pending migrations; `psql` as the staging role lists the tables from Task 2 and `schema_migrations` has 2 rows.
- [ ] **Step 6: Failure drill on staging** — deliver a release whose `migrate.sh` is `exit 1`. Expected: `Migration failed; the previous release is still serving`, exit 1, `current` unchanged, staging health 200.
- [ ] **Step 7: Import the starter content on staging only** — run `scripts/import-starter-content.ts` against the staging database through an SSH tunnel to loopback Postgres (`ssh -L 55432:127.0.0.1:5432`) with the staging role's credentials read from the root-only file. Expected: 5 worlds, 24 items, 14 answer rows; running it again changes nothing. **Do not run it against the production database.**
- [ ] **Step 8: Publish through the API on staging** — create an agent key for the Play world with `agent:create`, submit a valid `multiple_choice` quiz with a source, then a Kids submission, over HTTPS with the staging basic-auth credentials plus the agent key header. Expected: the Play item is `scheduled`; the Kids item is `in_review`; replaying the Play submission returns 200 with the same id; running `publishDue` (by hand through a one-off script) after moving `publish_at` into the past moves the Play item to `published` and leaves the Kids item untouched.
- [ ] **Step 9: Commit and ledger** — `git commit -m "ops: run migrations on deploy; staging rolled out and verified"`; record evidence in `docs/OPERATIONS.md`.

---

## Self-review against the spec (Project 1, first half)

- Schema with worlds, topics, items (audience, locale, evergreen, risk_tier, sources, status, publish_at, quality_report), revisions (10 kept), item_answers, events, agents, audit_log, sponsor tables, failed_jobs → Tasks 2 and 5. Image origin and licence recorded → Task 3.
- Starter content import with answers apart → Task 3. Item format per kind and per mechanic, documented → Task 4.
- Quality gates (schema, duplicates 90 days, blocked words and topics, sources resolve, Kids reading level, explained answer) → Task 6. Approval policy with Kids always in review and a per-world switch → Tasks 2, 7.
- Agent API (brief, submit with idempotency, status), per-agent hashed keys, rate limits → Task 8. Scheduled publishing, idempotent jobs with retries and failed_jobs → Task 9.
- Migrations on deploy with rollback behaviour → Tasks 1 and 10. Staging verification of the done-when path (draft → published, Kids stops in the queue) → Task 10.
- **Deliberately in plan 1B:** public pages from the database, anonymous play checking answers server-side, search and topic pages, template images, "Report a problem", admin sign-in with second factor, admin screens, the worker service, the daily digest, trust pages, accessibility pass, URL redirects and the production cut-over (with its backup precondition).
- Type consistency: `Db`, `Status`, `Audience`, `RiskTier`, `ItemSubmission`, `StoredItem`, `PublicItem`, `GateResult` are each defined in one task and used by name in later ones.
