# Production cut-over: checklist, runbook and rollback

Status: **prepared, not executed.** Nothing in this document has been run against production, staging, DNS or the VM.
Tracker tasks 1.17 and 1.18. Spec: Project 1 "Cut-over". Verdict: `docs/release/deployment-readiness-1d.md` (BLOCKED until the
blocks listed there are cleared). Operational background: `docs/OPERATIONS.md`.

## What the cut-over is

Today `sparkkindly.com` is served by Caddy from the static export in `/var/www/sparkkindly/public/current`. The new app already
runs on the VM as `sparkkindly-web` on `127.0.0.1:3100` with an **empty** production database and is not reachable from the
internet. A push to `main` only updates that loopback app; it does **not** change what visitors see. The visible switch is
one Caddy change: the `import` of the static snippet is swapped for the app snippet in both Caddyfiles
(`deploy/cutover/switch-to-app.sh`). The static export stays on disk, untouched, so rollback is one command.

## Owner decisions and authorizations (nothing below happens without them)

Authorizations (each is a separate action; say which one you grant):

1. **Merge 1C and 1D to `staging` and push `staging`** (deploys staging; the pipeline is the only path).
2. **Backups.** Set up the nightly encrypted backup and monthly restore test (tracker 0.9, 0.10: deferred by the owner until before any data import), including the B2 bucket and key, and the Better Stack heartbeat. Required before step 4.
3. **Push `main`** (deploys the app to production on 3100, still not public).
4. **Import the starter content into the production database** (`npm run content:import -- --allow-production` through an SSH tunnel; it refuses production without that flag).
5. **Real MailerSend token and the owner digest recipient** in `/opt/sparkkindly/shared/prod.env` (currently the placeholder `pending`); `SITE_RELEASE=true` there.
6. **Run `switch-to-app.sh` on the VM** (changes Caddy, reloads it).
7. **Add the production uptime monitor** (Better Stack) and keep the old static site for at least 14 days.
8. Run the **load test against staging** while watching MyLuxVacation (uses staging, shared; announce it in the tracker first).

Decisions the builder must not make (the trust pages are drafts until you decide):

- **Contact address.** No mailbox is confirmed. The Contact page publishes none and points at "Report a problem". To publish one, set `CONTACT_EMAIL` in `prod.env` to a mailbox you read, then restart. Decide whether `hello@sparkkindly.com` is read by a person.
- **Legal review of the Privacy and Terms drafts**, including governing law, liability wording and the legal entity name (absent from Terms on purpose). The Privacy page says no independent child-privacy review has happened; that remains true until tracker 3.11.
- **Hosting log retention.** The Privacy page says retention at Hostinger and in Caddy logs is unreviewed. Decide to check it (the quiz answer travels in the URL, so it can appear in access logs) or to configure log retention.
- **Auto-publication wording.** The Editorial policy says new items that pass the automatic checks can be published without a person reading them (spec decision of 30 October 2026) and that Kids items always wait for you. Confirm you are comfortable stating this publicly.
- **Community guidelines page** (tracker 1.15 mentions a placeholder): not shipped, because no comments or communities exist; it belongs to Project 7.
- Small label text (9 to 11px) is a design choice recorded as an open low finding in `docs/ACCESSIBILITY-REVIEW-1D.md`.

## Preconditions (all must be true before step 6)

- [ ] Project 1C merged (admin with second factor, worker service, digest) and tracker 1.19 done-when passed on staging.
- [ ] 1D branch merged; CI green on `staging` and on `main` (typecheck, lint, unit, build, e2e release and preview).
- [ ] Backups running; **one restore test passed by hand** (tracker 0.9, 0.10).
- [ ] `docs/ACCESSIBILITY-REVIEW-1D.md` unverified items (screen-reader pass, real devices) done or accepted by the owner.
- [ ] Independent review of `deploy/cutover/*` and `deploy/caddy/sparkkindly-public-app.caddy` (High-risk tier: deploy pipeline) completed. **PENDING**; this branch has only the author's tests.
- [ ] Staging comparison page by page (credentials typed into the shell, never into a command line or file: `read -r -p 'user: ' STAGING_USER; read -r -s -p 'password: ' STAGING_PASS; export STAGING_USER STAGING_PASS`, then `unset STAGING_USER STAGING_PASS` afterwards): `npx tsx scripts/url-inventory.ts --base https://staging.sparkkindly.com` prints `41 of 41 URLs as expected`.
- [ ] Image licences recorded in the image-origin field for every imported item (owner-supplied brand assets and the Unsplash photos). Check: `SELECT slug, image->>'rights' FROM items WHERE image IS NOT NULL;` on staging.
- [ ] Load test passed on staging at twice the expected launch traffic (see below), MyLuxVacation unaffected.
- [ ] Production `prod.env`: `SITE_RELEASE=true`, real `MAILERSEND_API_TOKEN`; `/api/health/` on loopback returns 200.
- [ ] Production uptime monitor created (owner).

## Load test (rehearsal on staging)

Expected launch traffic is not yet measured; pick a figure with the owner (suggest 5 requests per second sustained as "expected", so 10 for the test; the 1B local run served about 60 per second with one connection on a laptop and a throwaway database, which is not evidence for the VM).

1. Tell the tracker staging is in use for a load test.
2. In one terminal on the VM, watch MyLuxVacation and the box: `watch -n 5 'free -m; systemctl is-active myluxvacation* sparkkindly-web-staging; uptime'` and time `curl -o /dev/null -s -w "%{time_total}\n" https://myluxvacation.com/` every 10 seconds.
3. From the owner's machine, with credentials entered through `read -s` as above: `npx tsx scripts/load-test.ts --base https://staging.sparkkindly.com --concurrency 10 --seconds 120`. Pass: exit 0 (errors at most 1%, p95 at most 1500 ms) and MyLuxVacation response times and the 2 GB swap unchanged. Record the output and the watch notes in `docs/release/load-test-<date>.md`.
4. Both scripts accept only an allow-list of hosts (`localhost`, `127.0.0.1`, `staging.sparkkindly.com`; the inventory also `sparkkindly.com` for the post-cut-over check, and the load test only with `--allow-production`, which you must not use). A trailing dot, capitals, other IP addresses and lookalike names are refused; credentials are sent only over https or to loopback; non-numeric `--concurrency`, `--seconds` or `--max-p95-ms` exit 2; a run that made no request exits 1.

## Getting the scripts onto the VM

`deploy/` is not part of the release tarball. On the owner's machine, from a clean checkout of the exact commit that passed review (`git rev-parse HEAD`, `git status` clean), run `sha256sum deploy/cutover/*.sh deploy/caddy/sparkkindly-public-app.caddy`, copy those four files to the VM under `/root/cutover-<commit>/cutover/` and `/root/cutover-<commit>/caddy/` with `scp`, run `sha256sum` there and compare line by line. `switch-to-app.sh` also pins the snippet's SHA-256 in its own text and refuses a different snippet. Never run scripts pulled from a branch on the VM.

## Runbook (cut-over day)

1. Announce the window. Confirm every precondition above.
2. Final backup now and record its name; restore test is already done.
3. Push `main` (authorization 3). Watch the deploy: health passes, `previous` set. Check `curl -s http://127.0.0.1:3100/api/health/` on the VM.
4. Import (authorization 4), from the owner's machine through a temporary tunnel as in `docs/OPERATIONS.md` ("Starter content"). Expect 24 items and 14 answers; a second run adds nothing. Close the tunnel.
5. Check the app on loopback: `curl -s http://127.0.0.1:3100/discover/a-day-in-shadows/ | head -c 200` returns the article.
6. Dry run: `sudo deploy/cutover/switch-to-app.sh --confirm-owner-authorized --confirm-backup-verified --dry-run` must print `Dry run OK`.
7. Switch: the same command without `--dry-run`. It backs up both Caddyfiles, validates, reloads, checks `https://sparkkindly.com/api/health/` and restores by itself if anything fails. Note the backup directory it prints.
8. Verify (all read-only):
   - `npx tsx scripts/url-inventory.ts --base https://sparkkindly.com` prints `41 of 41 URLs as expected`.
   - `curl -s https://sparkkindly.com/robots.txt` says `Allow: /`; the sitemap lists items.
   - Open home, one article, one quiz (answer it), one Kids page, Report a problem (do not submit), and each trust page in a browser; the Kids pages send no third-party request (DevTools network).
   - On the VM: `ufw status numbered` shows the same 6 rules; `diff /etc/caddy/Caddyfile /opt/myluxvacation/deploy/Caddyfile` is empty; `curl -sI https://myluxvacation.com/` is 200 and `https://beta.myluxvacation.com/` is 401.
9. Commit the one-line import change in the MyLuxVacation repository's `deploy/Caddyfile` (owner), so its next deploy does not undo it.
10. Observe for 24 hours: uptime monitor, `journalctl -u sparkkindly-web -n 100`, digest (once 1C ships), MyLuxVacation response time.

## Rollback

Triggers: health or the inventory check fails after step 7 and is not understood within 10 minutes; MyLuxVacation is affected; a privacy or child-safety problem is found on the live pages.

1. `sudo deploy/cutover/rollback-to-static.sh [/etc/caddy/sparkkindly-backups/cutover-<stamp>]` (the directory step 7 printed is optional; if given it must be a `cutover-*` snapshot whose candidate equals the live Caddyfile). It reverses only the single import line in the **current** Caddyfiles (never an old snapshot, so newer MyLuxVacation edits survive), validates, reloads, removes the app snippet, then checks that `https://sparkkindly.com/` serves the static site (`/api/health/` 404, `/` 200) and `https://myluxvacation.com/` answers. It prints "rolled back." only after those checks. Exit codes: 1 refused or failed with the old state intact, 2 bad usage, 3 the Caddy reload itself failed (act now: `systemctl status caddy`), 4 reloaded but the live checks did not confirm.
   The switch script has the same behaviour on failure: from the first live write until its public checks pass, an error, Ctrl-C or TERM restores both files, reloads and verifies.
2. Verify: `curl -sI https://sparkkindly.com/` is 200 and serves the static site (`curl -s https://sparkkindly.com/ | grep -c _next/static` is non-zero and `/api/health/` is 404).
3. The app keeps running on loopback; its database and the imported rows are untouched. To roll the **app** back instead, use "Manual rollback" in `docs/OPERATIONS.md`.
4. Record what happened in the tracker; do not retry until the cause is fixed and the dry run is clean again.

If Caddy itself will not reload: on the VM swap the one `import` line back by hand in both Caddyfiles (`sparkkindly-public-app.caddy` to `sparkkindly-public.caddy`; do not copy an old snapshot over them, it may drop newer MyLuxVacation edits), `caddy validate`, `systemctl reload caddy`, and stop; MyLuxVacation shares that Caddy, so do not experiment.

## How this was verified

`tests/unit/cutover-scripts.test.ts` runs both scripts against a temporary directory with stub Caddy commands (refusals including preview builds and a tampered snippet, dry run, line-only swap in both files, rollback that keeps newer Caddyfile edits and refuses a non-matching backup, restore on failed public check, failed validation or an interrupt, exit codes 3 and 4). `tests/unit/cutover-guard.test.ts` covers the host allow-list and numeric option checks, `tests/unit/url-inventory.test.ts` the inventory. The production Caddy snippet's `handle_errors` maintenance reply (502/503/504) is unvalidated until the VM dry run. `scripts/url-inventory.ts` ran against the local test server (41 of 41) and `scripts/load-test.ts` ran for 10 seconds against it (614 requests, 0 errors; the local database is not the VM). **Not verified:** a real `caddy validate` of the app snippet (no Caddy on the build machine; step 6 does it on the VM), anything on the VM, the production load figure.
