# SparkKindly Roadmap Tracker

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` (approved by the owner on 30 October 2026).
**How to use:** one section per project, tasks in the order they should be done, each with the result that proves it is done. Tick tasks here as they finish. **[owner]** marks a task only the owner can do. Detailed, step-by-step implementation plans are written one project at a time, when that project starts, in `docs/superpowers/plans/`; Project 0's exists: `2026-10-30-project-0-foundations.md`.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` dropped (say why).

**Methodology:** every task is executed under `AGENTS.md` (task tiers, verification scope, review depth, completion
report) and the rules in `.claude/rules/`. Tasks touching sign-in, consent, child data, audience filtering, secrets,
schema, real data, the server or external integrations are High-risk and get independent review before merge.

**Order of work:** 0 → 1 → 2 → 3 → pilots → 4 → 7 → 8 → 5 → 6. Projects 5A and 6 may run alongside the pilots.

---

## Project 0: Foundations

Detailed plan: `docs/superpowers/plans/2026-10-30-project-0-foundations.md`.

- [ ] 0.1 Switch the app to a standalone Node server with `/api/health` reporting release, database and missing config — *unit tests pass; `npm run build` produces `.next/standalone`; e2e passes against `next start`.*
- [ ] 0.2 `sendEmail` through MailerSend with unit tests and a test-send script — *3 tests pass.*
- [ ] 0.3 **[owner]** Create accounts and records: Backblaze B2 bucket and key; Better Stack monitor and three heartbeats; MailerSend domain and token; DNS `staging` A record, MailerSend records, DMARC; agree a reboot window — *values handed to the builder.*
- [ ] 0.4 VM base provisioning script: updates, reboot if required, 2 GB swap, unattended-upgrades, `sparkkindly` user, Node 24.22.0 private install — *re-running changes nothing; MyLuxVacation unaffected.*
- [ ] 0.5 PostgreSQL 16 on loopback, role, two databases, env files — *app user connects to both; `nobody` cannot read env files.*
- [ ] 0.6 systemd units with memory limits, forced-command release receiver with health check and automatic rollback, sudoers — *bad tarball and failing release both leave `current` unchanged; prod on 3100 is not reachable from the internet.*
- [ ] 0.7 GitHub Actions: `main` → prod, `staging` → staging — *two green runs under 10 minutes; failing typecheck blocks deploy.*
- [ ] 0.8 Staging behind Caddy basic auth, noindex — *401 without credentials; `Disallow: /`; both Caddyfiles identical.*
- [ ] 0.9 **DEFERRED by owner (31 Oct 2026); must be done before Project 1 imports any data or any visitor data exists** — Nightly encrypted backups to B2 with 30-day retention and heartbeat — *file in B2; failed dump uploads nothing and pings nothing.*
- [ ] 0.10 **DEFERRED with 0.9** — Restore script and monthly restore test — *restore test passes once by hand; refuses to overwrite prod without `--force`.*
- [ ] 0.11 MailerSend verified; first real email from `hello@sparkkindly.com` — *SPF and DKIM pass; health `ok` on both envs.*
- [ ] 0.12 Disk check heartbeat and outage drill — *down and up emails received.*
- [ ] 0.13 Done-when evidence recorded; README updated for Windows — *deploy under 10 min, backup restored, alert received, firewall and Caddy unchanged.*

## Project 1: Platform core

- [ ] 1.1 Server-side error reporting (Sentry, server only; no browser SDK), no-op without DSN — *a thrown test error appears in Sentry; e2e third-party-request test still passes.* **[owner]** Sentry account.
- [x] 1.2 (1A, 1 Nov 2026: plain SQL migrations + runner, no ORM; runs on deploy, failing migration keeps the old release) Choose ORM and migration tool; migrations run in `deploy-receive.sh` via `migrate.sh`; expand-then-contract rule documented — *a migration applies on deploy and the previous release still starts.*
- [x] 1.3 (1A: migrations 001-002, Kids guarantee in the database) Schema: `worlds`, `topics`, `items` (with `audience`, `locale`, `evergreen`, `risk_tier`, `sources`, `status`, `publish_at`, `quality_report`), `item_revisions` (keep 10), `item_answers`, `events`, `agents`, `audit_log`, `sponsors`, `sponsorships`, `failed_jobs` — *migration tests; constraints enforce status transitions and audience values.*
- [x] 1.4 (1A: imported on STAGING only; production import waits for the cut-over and backups) Seed the five worlds and an initial curated topic list; import the 10 articles and 14 quizzes with image origin and licence recorded — *counts match; every item has a world, audience and tier.*
- [x] 1.5 (1A: docs/item-format.md, examples validated by a test) Item format document `docs/item-format.md` for each kind (`article`, `game` mechanics, `quiz`, `video_script`) with JSON schemas — *schema validation tests per kind.*
- [ ] 1.6 Public site: home, world pages, item pages (generic game renderer for the launch mechanics), topic pages, search (PostgreSQL full-text), sitemap, robots, structured data, template images — *e2e covers each page type; Core Web Vitals "good" on throttled mobile.*
- [ ] 1.7 Anonymous play: answers checked on the server; explained answers never sent before answering — *e2e: answer value absent from the page source until submitted.*
- [ ] 1.8 "Report a problem" link on every item, rate-limited, lands in the admin queue — *test submission appears in `/admin`.*
- [x] 1.9 (1A: verified live on staging; MCP connector for Claude Code added) Agent API: `GET /api/agent/brief`, `POST /api/agent/items` (idempotency key), `GET /api/agent/items/:id`; per-agent hashed keys; rate limits — *integration tests; a replayed submission returns the same item.*
- [x] 1.10 (1A: includes pinned-address source fetching) Server quality gates: schema, duplicates (slug and title similarity, 90 days), blocked words and topics, sources required and resolving for Sourced tier, Kids reading level, explained answer required — *each gate has a failing fixture; failures recorded in `quality_report`.*
- [x] 1.11 (1A) Approval policy engine: auto-schedule on pass, Kids always `in_review`, per-world auto/review switch — *Kids item stops; Play item schedules.*
- [~] 1.12 (1C built and tested locally, 1 Nov 2026; plan `2026-11-01-project-1c-admin-worker-digest.md`; staging verification and owner enrolment pending) Admin sign-in: email link for allow-listed owners plus authenticator code; audit log of every admin action — *second factor required; audit rows written.*
- [~] 1.13 (1C built and tested locally; agent topic proposals deferred to Project 2; staging sign-in verified 3 Nov 2026 (email link + authenticator, digest page loads); full walkthrough of each action pending) Admin area: approval queue, items (edit, unpublish, revisions), problem reports, worlds, topics (with agent proposals), agents and keys (create, rotate, revoke), run history, digest page — *owner completes each action in a walkthrough.*
- [~] 1.14 (1A done: publishDue + runJob + failed_jobs; 1C: worker timer + digest built and tested locally; units installed and a real digest email received on staging 3 Nov 2026; a due item publishing within a minute not yet observed) Worker service (systemd, `MemoryMax`): publishes due items, sends the daily digest, idempotent jobs with retries and `failed_jobs` alerts — *a due item publishes within a minute; digest email arrives.*
- [x] 1.15 (1D, 1 Nov 2026: six pages as drafts, e2e `trust-pages.spec.ts`; community guidelines page deliberately not shipped, no comments exist, belongs to Project 7; contact address, legal review and log retention are owner decisions in `docs/CUTOVER.md`) Trust pages rewritten: About, Privacy, Terms, Accessibility, Contact, Editorial policy (AI-assisted content and how it is checked), community guidelines placeholder — *pages live; no claims the launch record contradicts.*
- [~] 1.16 (1D: automated and scripted checks PASS, record `docs/ACCESSIBILITY-REVIEW-1D.md`; screen-reader and real-device passes UNVERIFIED, owner script in the record) Accessibility pass to WCAG 2.2 AA on the main flows (automated plus keyboard and screen reader) — *no serious or critical axe violations; manual checklist signed.*
- [~] 1.17 (1D: inventory script and tests, load-test script, runbook and rollback in `docs/CUTOVER.md`; staging comparison and the load test itself not run, they need owner go-ahead) Cut-over preparation: URL inventory and redirects (`/quiz/…`), page-by-page comparison on staging, load test at twice expected launch traffic while watching MyLuxVacation — *redirect tests pass; load test report in `docs/`.*
- [ ] 1.18 (1D prepared scripts and rollback, NOT executed; verdict BLOCKED in `docs/release/deployment-readiness-1d.md`) Cut-over: Caddy `sparkkindly.com` block → `reverse_proxy 127.0.0.1:3100`; old static export kept for rollback; production uptime monitor added — *public site served by the app; rollback rehearsed once.*
- [ ] 1.19 Done-when: owner creates an item in `/admin` and sees it live; API test publishes an item through `draft → published`; Kids item stops in queue; digest arrives.

## Project 2: The agent team

- [x] 2.1 `agents/` layout, shared runner, goals-file format, and `/daily-run` command — *runner loads a goals file and the brief.* **[built; plan 2026-11-02-project-2-agent-team.md]**
- [x] 2.2 Goals files for Play, Discover, Together, Grow, Kids, written for the 13–25 first audience; Kids for 6–9 — *owner reads and approves each.* **[owner approved 3 Nov 2026]**
- [x] 2.3 Master agent: reads brief and buffers, picks worlds, runs world agents, runs reviewer, submits, retries, logs, posts heartbeat — *dry run against staging produces items in `in_review`/`scheduled`.* **[DONE 3 Nov 2026: Play run on staging scheduled 3 items, 0 rejected (one retried once after a failed review); server brief shows 3 days ahead]**
- [~] 2.4 Reviewer agent: facts and sources (opens each URL), tone, age, originality, independent solve for Computable items — *fixtures: a wrong answer and an unsupported claim are rejected.* **[prompt and 5 fixtures; evaluation 5/5 on 3 Nov 2026 (docs/OPERATIONS.md); not yet seen on a real run]**
- [~] 2.5 Quality-over-quota and buffer rules (3 days; per-world caps) — *a world with no passing item submits nothing and the digest says so.* **[digest shortfall lines built; end-to-end not yet seen]**
- [~] 2.6 Windows Task Scheduler entries: several small runs a day; `claude -p` invocation; run log location — *tasks fire on schedule unattended.* **[REGISTERED 3 Nov 2026: 08:00 play+discover, 13:00 together+grow, 18:00 kids, all on staging; first unattended fire is 4 Nov 08:00 — not yet observed]**
- [ ] 2.7 First-week measurement on a reduced schedule: Claude Pro usage, items per run, time; confirm terms for scheduled use — *report in the digest; decision recorded.*
- [~] 2.8 Usage budget and limit handling: clean stop on rate limit; digest recommends upgrade when buffer missed 3 of 7 days — *simulated limit stops cleanly.* **[plan-limit stop in /daily-run, digest advice built; simulated limit not yet run]**
- [~] 2.9 Heartbeat alert: worker alerts if no master heartbeat in 36 hours — *alert fires when the task is disabled for a test.* **[worker alert built and unit-tested; live test (disable the task) not yet done]**
- [~] 2.10 `video_script` items produced from day one (not shown on site) — *scripts accumulate in the database.* **[video_script accepted by the API; Play goals ask for one a week; not yet produced]**
- [x] 2.11 (named by the owner on 1 Nov 2026; the address is held in the server's `ADMIN_EMAILS` config, not in this public repo) **[owner]** Name the backup approver for Kids items and contributor submissions — *name recorded in 4a.6.*
- [ ] 2.12 **[owner]** Name the first new world and what it covers — *goals file written.*
- [ ] 2.13 Add the new world with no code change (row, goals file, key) — *its agent publishes on the next run.*
- [ ] 2.14 Done-when: seven consecutive unattended days with at least one new item per world per day; Kids items in the queue; new world added without code.

## Project 3: Accounts and personal dashboards

- [~] 3.1 Account model with age groups (under 13 none; 13–15 consent pending/confirmed; 16–17; 18+) as settings; passwordless email link and Google sign-in — *sign-in tests; age group derived from date of birth.* In progress: email-link half built behind ACCOUNTS_ENABLED; Google sign-in deferred. See `docs/superpowers/plans/2026-11-03-project-3a-accounts-core.md`.
- [x] 3.2 Parental consent flow for 13–15: parent email, confirmation link, 7-day reminder, 30-day deletion, withdrawal link that deletes the account — *each path tested.* Built behind ACCOUNTS_ENABLED (Project 3B, `docs/OPERATIONS.md` Accounts); neutral age screen and retry block deferred to the privacy review (3.11).
- [~] 3.3 Permissions by age group (circles, comments, communities, contributing, child profiles, sponsorship visibility) in one place — *permission matrix tests.* In progress: policy table and isolation matrix done (consent token rows included); enforced per feature as features arrive. See `docs/superpowers/plans/2026-11-03-project-3a-accounts-core.md`.
- [x] 3.4 Child profiles (6–9, 10–12): display name and band only; 18+ parent/guardian confirmation; 4-digit PIN; profile switching; close at 13 — *e2e on a shared-device flow.* Built behind ACCOUNTS_ENABLED (Project 3C, `docs/OPERATIONS.md` Accounts, "Child profiles"); isolation rows in `tests/unit/account-isolation.test.ts`; per-child consent record deferred to the privacy review (3.11). See `docs/superpowers/plans/2026-11-04-project-3c-child-profiles.md`.
- [x] 3.5 Interests and the `/me` dashboard across worlds; audience filtering by profile — *a child profile never receives an `adults` item; test fixtures.* Built behind ACCOUNTS_ENABLED (Project 3D, `docs/OPERATIONS.md` "Interests, saved answers and /me"); isolation rows in `tests/unit/account-isolation.test.ts`. See `docs/superpowers/plans/2026-11-04-project-3d-interests-dashboard.md`.
- [x] 3.6 Stored answers per profile with correctness and time — *answer rows written; anonymous play unchanged.* First answer only, stored from a same-origin submit only (Project 3D); privacy and About copy still to be rewritten before go-live (3.10, 3.11).
- [x] 3.7 Notification preferences and time zone per account; one-click unsubscribe on every email — *unsubscribe link works without sign-in.* Built behind ACCOUNTS_ENABLED (Project 3E, `docs/OPERATIONS.md` "Settings, export, deletion and inactivity"); nothing sends the optional emails yet, and the future `List-Unsubscribe` header must point at `/account/unsubscribe/confirm/`. **[owner]** set `UNSUBSCRIBE_SECRET` in the staging and prod env files before use. Isolation rows in `tests/unit/account-isolation.test.ts`. See `docs/superpowers/plans/2026-11-04-project-3e-settings-privacy.md`.
- [x] 3.8 Data export and account deletion from settings; child profile deletion; 24-month inactivity deletion job — *export contains everything held; deletion removes all rows.* Built behind ACCOUNTS_ENABLED (Project 3E): JSON export (schema-checked for completeness), typed-email self-deletion over all seven personal-data tables, `inactivity-sweep` (730 days, notice, deletion 30 days later) and a PIN reset after a fresh email sign-in. Privacy and About copy still to be rewritten before go-live (3.10, 3.11).
- [~] 3.9 Rate limits on sign-up, sign-in links and invites — *limits enforced in tests.* In progress: sign-up and sign-in limits done; invites pending. See `docs/superpowers/plans/2026-11-03-project-3a-accounts-core.md`.
- [~] 3.10 Draft privacy policy, terms, community guidelines and data inventory — *documents in `docs/legal/` and on the site as drafts.* Drafts done in `docs/legal/` (Project 3F, `docs/superpowers/plans/2026-11-04-project-3f-legal-drafts.md`), with the page-copy and e2e changes in `go-live-copy-changes.md` and the checklist for 3.11. Not on the site: the plan keeps them unpublished until the professional review (3.11) approves them.
- [ ] 3.11 **[owner]** Arrange the professional privacy review (consent method, age-appropriate design, jurisdictions) — *review findings recorded; changes applied.*
- [ ] 3.12 Done-when: adult signs up, picks interests, sees dashboard, creates a child profile, deletes account; 14-year-old held at consent pending then joins a circle but cannot comment; parent withdrawal deletes the account.

## Pilots (gate before Project 4)

- [ ] P.1 **[owner]** Confirm the thresholds in spec 4a.2 or set new ones — *numbers recorded.*
- [x] P.2 Measurement in place: activation, return, interest uptake, operating hours, quality — *dashboard in `/admin`.* (built 4 Nov 2026, `/admin/pilot/`, plan `2026-11-04-pilot-measurement.md`; staging check pending)
- [ ] P.3 **[owner]** Pilot A: invite 20–30 people aged 13–25; 3 weeks — *participants signed up.*
- [ ] P.4 **[owner]** Pilot B: one friends' group chat playing the daily items; 2 weeks; hand tally — *daily answer rate recorded.*
- [ ] P.5 Pilot report against thresholds; owner records expand / change / stop in the spec — *decision written.*

## Project 4: Circles, competitions and invites

- [x] 4.1 Circles (friends, family, community): create, membership, owner actions (remove, transfer, close; 30-day score retention after close) — *tests for each action.* (4A, 5 Nov 2026, behind `CIRCLES_ENABLED`: create, list, leave, remove, transfer, close, child profiles in family circles, owner-deletion hand-over, 30-day purge; plan `2026-11-05-project-4a-circles-core.md`; joining by invite is 4.2/4B, scores 4C; staging check pending)
- [x] 4.2 Invites: shareable link (revocable), single-use email invites (14-day expiry), referral tracking, link previews for chat apps — *preview renders with title and image.* (4B, 5 Nov 2026, behind `CIRCLES_ENABLED`: link and email invites, preview page and branded image, sign-up return path, public communities, referrals, invite purge; plan `2026-11-05-project-4b-invites-joining.md`; staging check pending)
- [x] 4.3 Circle interests and time zone; daily set selection with child-safe filtering and "bonus" fill — *a circle with a child profile never gets an `adults` item.* (4C, 5 Nov 2026, behind `CIRCLES_ENABLED`: owner-chosen topics and worlds, five items a circle day, read-time audience re-filter; plan `2026-11-05-project-4c-daily-set-scores.md`; staging check pending)
- [x] 4.4 Scoring (correctness only), tallies daily/weekly/monthly/all-time, ties, re-scoring on corrections, "former member" rule, recompute on deletion — *property tests on tallies.* (4C: derived on read, competition ranks, points 0 to 100 in `/admin/pilot/`, `changeAnswerKey` re-scores stored choices and writes circle notices; `circles-scores.test.ts`, `circles-rescore.test.ts`)
- [x] 4.5 In-circle leaderboards only; no public rankings — *no public route exposes scores.* (4C: `/circles/<slug>/scores/` for current members and their child profiles only; a source scan keeps `lib/circles/scores` inside `app/circles` and `lib/circles`; e2e `circle-play.spec.ts`)
- [x] 4.6 Member notifications: daily set ready, weekly summary, honouring preferences — *emails sent per preference.* (4D: hourly `circle-mail` job, claims per circle/kind/period, re-score emails, RFC 8058 headers; `circles-mail.test.ts`, `circle-mail-job.test.ts`)
- [x] 4.7 Growth loop: post-answer invite and share prompts; branded share image without personal data — *share image contains no names.* (4D: prompt after a set answer, plain public item URL, the existing item template image; `circles-share-prompt.test.ts`, `circle-play.spec.ts`)
- [x] 4.8 Community moderation: blocked words on names and descriptions, owner hide, leave and report — *tests.* (4D: member reports, `/admin/circles/` hide and restore, audited; `circles-reports.test.ts`, `circles.spec.ts`)
- [x] 4.9 Younger-teen rules: 13–15 cannot join public communities — *permission tests.* (4A: 13–17 create friends circles only and a consent-pending 13–15 creates none; 4B: the shared join rules refuse 13–15 in communities, 13–17 in a circle with a child profile and consent-pending 13–15 everywhere; `account-isolation.test.ts`)
- [x] 4.10 Done-when: a circle of four, including two child profiles, plays the daily set and sees scores; a friend joins through a link. (e2e `circle-play.spec.ts`, 4C; with 4D's emails, reports and share prompt Project 4 is built behind `CIRCLES_ENABLED`, staging check pending)

## Project 5: Social media distribution

- [ ] 5.1 **[owner]** Share access to the SparkKindly Instagram, Facebook, TikTok and YouTube accounts; Meta Business account, Page, Instagram professional account, Meta developer app and review; TikTok developer app and Content Posting approval; Google Cloud project with YouTube Data API — *approvals granted (weeks; start during Project 0).*
- [ ] 5.2 `distributions` table and per-platform daily caps in `/admin` (Instagram 2, Facebook 3, TikTok 1, YouTube 1) — *caps editable.*
- [ ] 5.3 Daily selection rule: rotate worlds, prefer playable, prefer popular topics, never Kids; `skipped` with reason — *selection tests.*
- [ ] 5.4 Promotion agent: captions and hashtags per platform; branded share image — *output validated against platform limits.*
- [ ] 5.5 Worker posting to Instagram and Facebook via Meta Graph API with UTM links; metrics collection — *a published item appears on both with a working link.*
- [ ] 5.6 Unpublish cancels scheduled posts and flags posted ones — *test.*
- [ ] 5.7 Video jobs queue: brief generation (script, shot list, on-screen text, captions, assets), job in `/admin`, upload of finished file — *a job round-trips.*
- [ ] 5.8 **[owner]** Decide who makes the videos (person or tool such as Canva) — *recorded.*
- [ ] 5.9 Worker posting to TikTok and YouTube from attached files — *a Short is posted with no further human step.*
- [ ] 5.10 Done-when: selected items on Instagram and Facebook by the configured time; skips visible; a finished video is posted automatically.

## Project 6: Light sponsorship

- [ ] 6.1 `sponsors` and `sponsorships` admin screens; excluded-category checklist at creation — *owner can attach a sponsor to a Grow topic.*
- [ ] 6.2 Rendering: one line, fixed position, plain-language disclosure next to the link, `rel="sponsored"`; only on `adults` items; never to child profiles, under-18 accounts, or circles with children — *visibility tests for each rule.*
- [ ] 6.3 Click counting without third-party scripts — *counts increment.*
- [ ] 6.4 Disclosure page and contributor-terms note — *pages live.*
- [ ] 6.5 Done-when: sponsor line appears on matching adult items with clicks counted and is absent for a child profile.

## Project 7: Comments and moderation

- [x] 7.1 `comments`, `comment_reports`, `profile_trust`; one-level replies; edit within 15 minutes; delete; account deletion removes comments — *tests.* (7A, 5 Nov 2026, behind `COMMENTS_ENABLED`: `comments` and `account_trust` (the spec's `profile_trust`; trust is per account), migration 021; `comment_reports` arrives with 7.5 in 7B; `comments-repo.test.ts`; plan `2026-11-05-project-7a-comments-core.md`)
- [x] 7.2 Who can comment: 16+ only; Kids items never carry comments; per-world and per-item switches — *permission tests.* (7A: ruling that Kids never carries comments whatever the switches; `/admin/comments/` world and item switches, audited; child contexts get no section; `account-isolation.test.ts`, e2e `comments.spec.ts`)
- [x] 7.3 Server checks: blocked words, length, rate limit, duplicates, link policy by trust — *fixtures.* (7A: `comments-checks.test.ts`)
- [x] 7.4 Trust levels (hold until five approvals; demotion; owner override; random post-publication sampling) — *tests.* (7A: ladder, demotion, owner level and ban built, `comments-trust.test.ts`; 7B, 5 Nov 2026: agent approvals promote, rejections demote, about 10% of new level-1 comments sampled, `comments-moderation.test.ts`)
- [ ] 7.5 Reporting: trust-weighted, two reports hide, urgent report hides immediately and emails the owner — *tests; urgent email received.* (7B built behind `COMMENTS_ENABLED`: `comments-reports.test.ts`, `comments-report-web.test.tsx`, e2e `comment-moderation.spec.ts`; urgent hides at once only from a level-1 reporter (controller ruling), 3 urgent a day; the urgent email to a real inbox is still to be received on staging)
- [ ] 7.6 Moderation agent in the daily and mid-day runs: approve, reject with reason, escalate — *held comments resolved in a dry run.* (7B: API, role-scoped key, MCP tools, `sparkkindly-moderator` and `/moderate-run` built and tested; the staging dry run and the Task Scheduler entry are still to do)
- [x] 7.7 Appeals path and response targets; digest counts — *appeal lands in the owner queue.* (7B: signed 30-day appeal link, owner overturn or uphold in `/admin/comments/` with 4a.6 targets, digest counts; `comments-appeals.test.ts`, `comments-owner.test.tsx`, e2e `comment-moderation.spec.ts`)
- [ ] 7.8 Community guidelines page shown at first comment — *page live and linked.* (7A: draft `/community/guidelines/`, 404 with comments off, linked from every comment form and ticked at the first comment; owner copy review pending; 7B links it from the rejection email and the appeal page)
- [ ] 7.9 Done-when: first comment held then published without owner action; level-1 comment instant; two reports hide; child profile sees none; owner gets only escalations.

## Project 8: Contributors

- [ ] 8.1 Contributor role (16+), contributor terms and licence text, display name and bio — *role toggle with terms acceptance.*
- [ ] 8.2 Submission editor at `/me/contribute`: articles and quiz questions, topics from the curated list, sources, originality declaration; three pending max — *validation tests.*
- [ ] 8.3 Same pipeline as agent items plus owner approval always; best-effort plagiarism search in the reviewer — *a copied paragraph is flagged.*
- [ ] 8.4 Revision requests and rejections with reasons; contributor notifications and publication email with share link — *emails sent.*
- [ ] 8.5 Bylines, contributor pages, byline carried into social posts; minors by display name only — *pages render.*
- [ ] 8.6 Unpublish on contributor request within the problem-report target — *test.*
- [ ] 8.7 Contributor trust and role removal — *tests.*
- [ ] 8.8 **[owner]** Decide whether contributors are ever paid — *recorded.*
- [ ] 8.9 Done-when: submission with a missing source is flagged, fixed, approved from the shared queue, published with byline and contributor page, and the contributor is emailed.

---

## Standing owner actions (not tied to one project)

- [ ] Monthly budget ceiling: confirm about $150/month or set another figure.
- [ ] Keep the Backblaze, Better Stack, MailerSend and Sentry accounts under the owner's own logins; share credentials with the builder only through the agreed channel, never in chat logs or the repository.
- [ ] Store the backup encryption private key in a password manager.
