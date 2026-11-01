# Project 1D: Trust Pages, Accessibility Sign-off and Cut-over Preparation

> Execute inline with superpowers:executing-plans and test-driven-development. Ledger (git-ignored): `.superpowers/sdd/2026-11-01-project-1d-trust-a11y-cutover/progress.md`.

**Goal:** Tracker 1.15 (trust pages), 1.16 (accessibility sign-off) and the preparation half of 1.17/1.18 (inventory, load test, runbook, rollback, readiness verdict). The cut-over itself is **not executed**; it needs owner authorization (listed in `docs/CUTOVER.md`).

**Tier:** Standard for trust copy and accessibility fixes (public UI, no auth/data change). Cut-over scripts and Caddy config are High-risk by AGENTS.md (deploy pipeline, provisioning), so they are written for review and verified only by dry-run/local checks; independent review before the owner runs them is PENDING.

**Spec:** design spec Project 1 (cut-over, trust pages), Project 0 deploy model, "Accessibility and performance". Branch base: `project-1-platform-core` (1B).

## Scope ruling

- Do not touch 1C areas (`app/admin`, `lib/admin`, `lib/auth`, worker/digest, `lib/agents`, `lib/items`, `db/migrations`). Shared files are edited additively (`app/globals.css`, `docs/OPERATIONS.md`, `tests/e2e/site.spec.ts` route list, `lib/config.ts`).
- Trust copy states only what runs today. Accounts, comments, circles, contributors and sponsorship do not exist; copy may say "not available" and what the plan is, never offer them. Anything needing an owner or legal decision is marked in `docs/CUTOVER.md` section "Owner decisions", not invented.
- "Community guidelines placeholder" (tracker 1.15) is **not** shipped: there are no comments or communities, so a page would promise a feature that does not exist. It belongs with Project 7. Ruling recorded in the tracker.

## Tasks

### Task 1: deferred 1B accessibility minors (tests first)
Files: `tests/e2e/a11y-fixes.spec.ts` (new), `tests/unit/sitemap.test.ts`, `tests/unit/play-check.test.ts`, `components/item/{ItemCard,PlayForm,PlayResult,PlayPanel}.tsx`, new `components/{Breadcrumb,Pager}.tsx`, `app/report/[world]/[slug]/{page.tsx,submit/route.ts}`, `app/{search,topics/[slug],quiz/archive,[world],[world]/[slug]}/page.tsx`, `lib/public/sitemap.ts`, `lib/play/check.ts`/`PlayResult`.
- Result block focusable (`id="result"`, `tabIndex=-1`) and the GET form / report redirect land on `#result`; test asserts focus moves there after submit (JS on) and the URL fragment (JS off).
- `ItemCard` gets `headingLevel` (2 under an h1, 3 under an h2); test: no heading skips on search, topic, archive, world, home, item.
- `Breadcrumb` with `aria-current="page"` on the last crumb, used by trust, world, topic and item pages.
- `Pager` renders nothing when there is no previous or next link (no empty "Pages" landmark).
- put_in_order duplicate positions give a specific message; report form has no pre-selected reason (radio group `required`); `/quiz/` leaves the sitemap (canonical points at the quiz's own page).

### Task 2: accessibility sign-off
Files: `tests/e2e/a11y-signoff.spec.ts` (new), `app/globals.css` (additive fixes), `docs/ACCESSIBILITY-REVIEW-1D.md` (template `.claude/templates/accessibility-review.md`).
- axe (wcag2a/aa/21aa/22aa, all impacts, not only serious) over every public page and state: home, five worlds, a topic, search with and without results, an article, a quiz before and after answering, a game, archive, report form (empty, sent, error), every trust page, 404.
- Keyboard: skip link works and lands focus in main; every playable mechanic answerable by keyboard only; report form by keyboard; mobile menu already covered. Focus indicator visible on every focusable control (computed outline), including textarea and select.
- Reflow: no horizontal scroll at 320px on every page above; touch targets at least 24px (WCAG 2.2 2.5.8) for the footer, pager and breadcrumb links.
- Findings fixed or recorded in the review doc. Screen-reader pass cannot be run by this agent: recorded UNVERIFIED with a script for the owner.

### Task 3: trust pages
Files: `components/TrustPage.tsx` (new), `app/(trust)/{about,privacy,accessibility,contact,editorial-policy,terms}/page.tsx`, `components/Footer.tsx`, `lib/public/sitemap.ts`, `lib/config.ts` (`contactEmail` from `CONTACT_EMAIL`), `deploy/env/*.env.example`, `tests/e2e/trust-pages.spec.ts` (new), `tests/e2e/site.spec.ts` (route list), `docs/kb/*.md`.
- Pages rewritten to the present product (database-backed, AI-assisted agents, scheduled/auto-approved items, Kids waits for owner approval, report a problem, no trackers, no accounts yet). New Terms page. Contact shows the address only when `CONTACT_EMAIL` is set; otherwise it points at the report form and says the address is pending.
- Tests: each page 200, one h1, linked from the footer, in the sitemap on a release build; claim tests (no page promises accounts or comments as available; the privacy page states no third-party requests; the contact page shows no invented address when unset); privacy e2e unchanged.
- KBs titled by symptom: a reader reports a wrong answer or problem; the site shows an error page after a deploy.

### Task 4: cut-over preparation (written, not executed)
Files: `scripts/url-inventory.ts`, `lib/cutover/inventory.ts`, `tests/unit/url-inventory.test.ts`, `scripts/load-test.ts`, `deploy/caddy/sparkkindly-public-app.caddy`, `deploy/cutover/{switch-to-app.sh,rollback-to-static.sh,verify.sh}`, `docs/CUTOVER.md`, `docs/release/deployment-readiness-1d.md`.
- Inventory: the live mock-up's URL list from the spec, each with expected status (200 or 308 target), checked against any base URL with optional basic auth from the environment. Unit-tested pure logic; CLI run against the local e2e server.
- Load test: dependency-free concurrent GET loop with a fixed request mix and latency percentiles, refusing the production host unless `--allow-production`; run against the local server only.
- Caddy block that reverse-proxies `sparkkindly.com` to 127.0.0.1:3100 keeping the static export path for rollback. Switch script mirrors `activate-public.py`: timestamped backup of both Caddyfiles (they must stay identical), `caddy validate`, reload, restore on failure. `bash -n` and a dry-run mode are the verification here; the real run is the owner's.
- Deployment-readiness verdict using the template. Expected BLOCKED until backups, data import, owner approvals and independent review exist.

### Task 5: documentation
`docs/OPERATIONS.md` (Project 1D section, additive), tracker entries 1.15/1.16/1.17/1.18 with evidence pointers.

## Review Focus

1. **Copy accuracy:** every sentence on the trust pages is true of the running product; nothing promises accounts, comments, email contact or compliance.
2. **Privacy invariants:** no third-party request, no storage identifier on any new page (privacy e2e covers trust pages).
3. **Accessibility fixes do not regress play:** answers still absent before submit; no-JS flow still works.
4. **Cut-over safety:** the scripts cannot touch MyLuxVacation blocks, refuse on Caddyfile mismatch, validate before reload, restore on failure, and rollback is one command. Not executed anywhere.

## Verification

`npm run typecheck`, `npm run lint`, `npx vitest run` (one baseline failure, `item-format-docs`, predates 1D), build with `SITE_RELEASE=false` and the full Playwright run on the final code state.
