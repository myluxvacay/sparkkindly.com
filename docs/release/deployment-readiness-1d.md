# Deployment Readiness: production cut-over of the database-backed site (Projects 1B + 1C + 1D)

Overall: **BLOCKED**

Assessed 1 November 2026 from the repository and local runs only. No server, staging environment, production, DNS or secret was touched or queried, so every server-state item is UNVERIFIED rather than PASS. Procedure: `docs/CUTOVER.md`. This is the 1D branch; 1C is a parallel branch not yet merged.

## Configuration

- Production env keys expected by health: `DATABASE_URL`, `MAILERSEND_API_TOKEN`, `MAIL_FROM`, `SITE_RELEASE` (`deploy/env/prod.env.example`). New optional `CONTACT_EMAIL` documented, defaults to unset. UNVERIFIED: actual `/opt/sparkkindly/shared/prod.env` (the token was a placeholder `pending` on 31 October). Parity with staging not checked.

## Database / Migration

- No migration in 1D. Previous migrations 000 to 004 apply through `migrate.sh` on deploy (1A/1B evidence). The production database is **empty** by design until the cut-over import. UNVERIFIED on production.

## API / Contracts

- Unchanged by 1D. The agent API and item format are 1A's; their tests pass in the unit suite.

## Build / Runtime

- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 6 warnings (pre-existing, none in 1D files). Vitest (after the review-fix pass): 392 passed, 1 failed (`item-format-docs` "has an example for each kind"; fails identically on the 1B base commit, probably line endings of `docs/item-format.md` on Windows; not changed by 1D). Build succeeds with `SITE_RELEASE=false` and with the release default.
- Playwright: 72 passed with the preview build (71 before the review-fix pass, which also passed with the release build; baseline before 1D was 51), including the privacy gate (no third-party requests, no storage identifiers) and the existing axe test.

## Server / Infrastructure

- UNVERIFIED: services, disk, swap, firewall (6 rules), Caddyfile parity, MyLuxVacation state. **No backup exists** (tracker 0.9 and 0.10 deferred by the owner until before data import); no restore test.

## Security

- No security-sensitive application code changed. Cut-over scripts are High-risk (deploy pipeline): they refuse without two explicit confirmations, refuse on Caddyfile drift, validate before reload, restore on failure, and swap only one import line. Tested against stub commands only. **Independent review PENDING.** `npm audit` was not run in this task.

## Accessibility

- PASS for the scripted checks in `docs/ACCESSIBILITY-REVIEW-1D.md` (axe all impacts over 31 pages and states: 0 violations; keyboard, focus, 320px reflow, target size). Screen-reader and real-device passes UNVERIFIED.

## Data Isolation / Child Safety

- Out of scope for 1D (no auth or audience logic touched). Public reads still take the anonymous scope. The Kids guarantee is 1A's database constraint. Kids pages keep the no-third-party and no-storage test.

## Performance / Resilience

- Load test **not run** on staging (needs owner go-ahead and a watch on MyLuxVacation). The script ran 10 seconds locally only. Core Web Vitals not measured.

## Observability

- UNVERIFIED and likely missing: production uptime monitor, Better Stack heartbeats, daily digest (1C), Sentry (tracker 1.1 not started).

## Documentation

- `docs/CUTOVER.md` (runbook, rollback, authorizations), `docs/OPERATIONS.md` section, `docs/kb/KB-001`, `KB-002`, tracker updated. Trust pages are drafts pending the owner decisions listed in `docs/CUTOVER.md`.

## Rollback

- Defined: `deploy/cutover/rollback-to-static.sh <backup dir>` restores both Caddyfiles from the timestamped backup; the static export is never modified; the app keeps running on loopback. Rehearsed only against stubs, not on the VM.

## Warnings

- Privacy and Terms are builder drafts, not legally reviewed; hosting log retention unreviewed; a quiz answer travels in the URL and can appear in access logs.
- No contact address is published (owner decision).
- Open low accessibility finding: 9 to 11px label text.

## Blocks

1. Project 1C is not merged (admin, second factor, worker, digest) and tracker 1.19 has not passed on staging.
2. No backups and no restore test (0.9, 0.10); required before importing data.
3. Real MailerSend token not set; production uptime monitor not created.
4. Independent review of `deploy/cutover/*` and the production Caddy snippet pending.
5. Staging page-by-page comparison and the load test not run.
6. Owner authorizations in `docs/CUTOVER.md` not given.

## Unverified / Out of Scope

Everything on the VM and in production; `npm audit`; real `caddy validate` of the app snippet; screen-reader and device passes; the cut-over itself (not executed).
