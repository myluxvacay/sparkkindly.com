# SparkKindly operations

How the SparkKindly server is laid out and how to operate it. Written from what was run and verified on the VM
(`2.25.121.2`, Ubuntu 24.04) on 31 October 2026. The provisioning scripts under `deploy/provision/` are the record of
truth for setup; re-run them after any manual change so they stay accurate. MyLuxVacation shares this VM and is
never touched by anything here.

## VM layout

| Path | Owner | Purpose |
|---|---|---|
| `/opt/sparkkindly/` | root | `node/` (private Node 24.22.0), `bin/` (deploy script), `home/<user>/.ssh` (deploy keys), `shared/` |
| `/opt/sparkkindly/shared/` | root, mode 711 | `prod.env`, `staging.env` (each readable only by its own service user), `db-prod.pass`, `db-staging.pass` (root only) |
| `/opt/sparkkindly/app/` | `sparkkindly` | production `releases/`, `current`, `previous` |
| `/opt/sparkkindly-staging/` | `sparkkindly-staging` | staging `releases/`, `current`, `previous` |

| Environment | OS user | Service | Port | Database role and database |
|---|---|---|---|---|
| production | `sparkkindly` | `sparkkindly-web` (1 GB limit) | 3100 | `sparkkindly` / `sparkkindly` |
| staging | `sparkkindly-staging` | `sparkkindly-web-staging` (512 MB limit) | 3101 | `sparkkindly_staging` / `sparkkindly_staging` |

Ports bind to loopback only; `ufw` allows only 22, 80 and 443. PostgreSQL 16 listens on loopback only. Each role can
connect only to its own database. A web process can write only its own release directory, never the deploy script,
its deploy key, or the env files.

## Deploy and rollback

A release is the Next.js standalone build plus `.next/static`, `public/` and a `RELEASE` file holding the commit hash,
as a gzipped tarball. It is piped to the deploy login over SSH; the login, not the client's command, fixes the target:

- `sparkkindly@2.25.121.2` with `~/.ssh/sparkkindly-deploy-prod` deploys production
- `sparkkindly-staging@2.25.121.2` with `~/.ssh/sparkkindly-deploy-staging` deploys staging

The receiver (`/opt/sparkkindly/bin/deploy-receive.sh`) extracts the release beside the others, runs its optional
`migrate.sh`, switches `current`, restarts the service and waits up to 30 seconds for `/api/health/` to return 200.
If it does not, it switches back, restarts, prints the last 50 journal lines and exits 1. `previous` is only ever set
from a release that passed health. The newest five releases are kept.

Manual delivery from Windows PowerShell (do not pipe bytes through PowerShell; use `cmd` redirection):

```powershell
cmd /c "ssh -i $env:USERPROFILE\.ssh\sparkkindly-deploy-staging -o IdentitiesOnly=yes sparkkindly-staging@2.25.121.2 deploy < release.tgz"
```

Manual rollback (as root on the VM):

```bash
cd /opt/sparkkindly-staging   # or /opt/sparkkindly/app
ln -sfn "$(readlink previous)" current.tmp && mv -T current.tmp current && systemctl restart sparkkindly-web-staging
```

Logs: `journalctl -u sparkkindly-web -n 100` (production), `journalctl -u sparkkindly-web-staging -n 100`.

## Health endpoint

`GET /api/health/` (note the trailing slash: the site redirects `/api/health` with a 308, which a plain `curl -f`
treats as success). Returns 200 when the database answers and all of `DATABASE_URL`, `MAILERSEND_API_TOKEN`,
`MAIL_FROM`, `SITE_RELEASE` are set, else 503. Callers on loopback (the deploy script, on-box checks) get the full
report; anything arriving through the proxy gets only `{"ok":…}`. The database check is cached for 5 seconds.

## Database and environment files

`02-postgres.sh` generates each environment's password once and writes its env file only if absent. To rotate a
password: delete that `db-<env>.pass` and `<env>.env`, re-run `02-postgres.sh`, restart the service.
`MAILERSEND_API_TOKEN=pending` is a placeholder so health passes until the real token is set.

## Verification record (31 October 2026)

All run against the real VM; Caddy, MongoDB, MyLuxVacation (production and beta), `ufw` (6 rules) and the Caddyfiles
were checked unchanged afterwards, and myluxvacation.com, beta.myluxvacation.com and sparkkindly.com answered 200,
401 and 200 before and after.

- Base provisioning: swap 2 GB, two users, Node v24.22.0 (checksum verified), second run exit 0 and one swap entry.
- PostgreSQL: own database reachable, other environment's database refused (`permission denied`) in both directions;
  env files readable only by their own user; second run exit 0.
- Receiver: garbage input rejected, live release unchanged; crashing release rolled back, `previous` unset; running
  but unhealthy release (blank token, 503) rolled back; staging login asked for `prod`, production untouched and every
  write to root-owned paths denied; identical deploy keys refused by the installer.
- Production: release deployed on 3100, healthy, loopback only, not reachable from outside; the public site still
  serves the mock-up (Caddy untouched).

## Staging site

`https://staging.sparkkindly.com` is the staging environment (service `sparkkindly-web-staging`, port 3101) behind Caddy with basic auth. It is noindex three ways: `SITE_RELEASE=false` (robots `Disallow: /`, empty sitemap) and an `X-Robots-Tag` header.

- **Config:** `deploy/caddy/sparkkindly-staging.caddy`, installed to `/etc/caddy/` by `deploy/provision/04-caddy-staging.sh`, with a single `import` line added to **both** `/etc/caddy/Caddyfile` and MyLuxVacation's tracked `/opt/myluxvacation/deploy/Caddyfile` (`activate-public.py` requires them identical). The script backs both up to `/root/caddy-backups/<timestamp>/`, validates, and restores them if validation fails.
- **Login:** user `sparkkindly`; the hash is in `/etc/caddy/sparkkindly-staging.users` (root:caddy 640) and the generated password in `/opt/sparkkindly/shared/staging-basic-auth.txt` (root only). The owner's copy is in their local secrets file.
- **Rotate the password:** delete both files, re-run `04-caddy-staging.sh`, update the Better Stack monitor.
- **Open item for the owner:** the tracked `deploy/Caddyfile` in the MyLuxVacation repository now has one extra line; commit it there so a future MyLuxVacation deploy does not drop the staging site.
- **Verified 31 October 2026:** no password 401, wrong password 401, right password 200 with only `{"ok":true}` visible, robots `Disallow: /`, sitemap empty, article page 200, HTTP redirects to HTTPS; other sites unchanged (200, 401, 200), 6 firewall rules.

## Database, migrations and the agent API (Project 1A)

**Migrations.** SQL files in `db/migrations/` (`NNN_name.sql`, consecutive from 000). Every release ships them with
`migrate.sh`; the receiver runs it from the new release, with that environment's env file loaded, **before** switching
the live symlink. All pending migrations apply in one transaction under an advisory lock. If it fails, the old release
keeps serving (`Migration failed; the previous release is still serving`, exit 1). Rule: **expand-then-contract**, so the
previous release must still run on the newer schema; a migration may only drop something if its filename contains
`contract` (a test enforces this). By hand on the VM, as the staging user:
`cd /opt/sparkkindly-staging/current && set -a && . /opt/sparkkindly/shared/staging.env && set +a && /opt/sparkkindly/node/bin/node db/migrate.mjs`.

**Starter content (staging only).** `npm run content:import` seeds the five worlds and the curated topics and imports the
10 articles and 14 quizzes, with answers stored apart. It is idempotent and **refuses the production database** unless
given `--allow-production`, which is a cut-over step that needs a verified backup first. Run it through a temporary SSH
tunnel (`ssh -N -L 55432:127.0.0.1:5432 root@2.25.121.2`) with `DATABASE_URL` built from
`/opt/sparkkindly/shared/db-staging.pass`, and close the tunnel afterwards.

**Agents.** `npm run agent:create -- <name> [--world <slug>]` (no `--world` makes the master agent) prints a key once and
stores only its hash. The key goes in the `X-Agent-Key` header, never `Authorization`, because staging's basic auth uses
that one. Endpoints, all with a trailing slash: `GET /api/agent/brief/?world=`, `POST /api/agent/items/`,
`GET /api/agent/items/<id>/`. Shapes are in `docs/item-format.md`. Limits: 60 requests a minute per agent, 200 KB bodies.

**Publishing.** Items the policy schedules publish when due. `npm run job:publish-due` runs the same job once by hand (the
worker service that runs it on a schedule is Project 1B). Kids content, and anything in a world set to review mode, never
reaches `scheduled` or `published` without `approved_by`. The database enforces this itself (constraint
`kids_requires_approval` and a trigger), not only the code.

**Verified on staging, 1 November 2026 (UTC).** Release 67fb91b: the receiver applied migrations 000, 001 and 002 and then
reported healthy; 13 tables including `schema_migrations`, the constraint and the trigger present, tables owned by the
staging role, the production database still empty. The Kids guarantee refused an unapproved scheduled insert in a
review-mode world on the real PostgreSQL. A release whose migration failed was rejected and the old release stayed
healthy. Import: 24 items and 14 answers; a second run added nothing. Live API over HTTPS: brief 200 (57 topics, 7
mechanics); a passing quiz was scheduled for the next 06:00 UTC; a replay returned the same item; a Kids submission went
to `in_review`; invalid input got 422; a wrong key, no key, or a key without the staging login each got 401; a real source
URL passed, and `localtest.me` (a public name that resolves to 127.0.0.1) was refused by the pinned lookup; the publish job
published the one due item and left the Kids item, the future item and the draft alone. The test items were removed
afterwards, leaving the 24 starter items and one agent, `staging-play`.

## Claude Code connector (Project 1A, Task 11)

`.mcp.json` registers two project MCP servers, `sparkkindly-staging` and `sparkkindly-prod`, started with
`node --import tsx agents/mcp/server.ts --env <staging|prod>`. They give Claude Code five tools
(`sparkkindly_item_format`, `sparkkindly_brief`, `sparkkindly_submit_item`, `sparkkindly_item_status`) over the agent API.
Settings and keys are read from the owner's secrets file (default `~/sparkkindly-secrets.txt`), never from the repository.
Setup and use are in `agents/README.md`. Check it with `npx tsx scripts/mcp-smoke.ts --env staging [--live]`.

Verified 1 November 2026 (UTC): the smoke test listed the four tools and, live against staging, read the brief, submitted
a quiz (201, scheduled), resubmitted it (200, replayed, same id), got 422 `invalid_item` for a bad item, and read the status.
A headless `claude -p` session loaded `.mcp.json`, called `sparkkindly_brief` on staging and reported world `play` with 57
topics. The test item was removed afterwards (staging holds the 24 starter items).

## Reboot (31 October 2026)

Rebooted with the owner's permission to load the updated libraries. Back in about 40 seconds. Afterwards: all ten services active (Caddy, MongoDB, SSH socket, ufw, fail2ban, PostgreSQL, both MyLuxVacation apps, SparkKindly production and staging), 2 GB swap active, 6 firewall rules, both SparkKindly releases healthy (200), no failed units, no service listed as running old libraries, kernel current. myluxvacation.com 200, beta 401, sparkkindly.com 200.

## Not yet done

Backups, monitoring and email come in later tasks of the Project 0 plan.

## Public site (Project 1B)

The public pages (home, worlds, topics, items, play, quiz, search, report a problem, sitemap) read the database; nothing
renders from `content/` any more except the import scripts and `validate-content`. Pages are `force-dynamic`.

- **Play is server-checked.** Answers live only in `item_answers` and leave the server only after a response is submitted
  (`lib/play/answer.ts`). The report POST accepts at most 8 KB.
- **Template images** (`/api/template-image/<world>/<slug>/`) are drawn locally; titles are reduced to Latin text so the
  renderer never fetches a font or emoji from a CDN.
- **Local run** (throwaway database, starter content): `npx tsx scripts/e2e-db.ts`, then
  `SITE_RELEASE=false DB_POOL_MAX=1 DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres?sslmode=disable npx next start -p 3000`.

**Verified on staging, 1 November 2026 (UTC).** Release `468dd47`: CI and Deploy succeeded. With the basic-auth login from
the owner's secrets file (not echoed): `/`, the five worlds, a starter article, a Kids article, `/quiz/`, `/quiz/archive/`,
`/search/?q=shadow` and the sitemap answered 200; the template image is `image/png`; `/api/health/` is `{"ok":true}`;
`/quiz/number-detective-001/` answers 308 to `/play/number-detective-001/`; an unanswered quiz page contains no
explanation text and `?r=c` shows "Correct"; the sitemap has no entries and `robots.txt` is `Disallow: /`.
**Not yet verified on staging:** a report submitted from an item landing in `problem_reports` (needs the SSH-tunnel row
count), and that production, `ufw` and the Caddyfiles are unchanged (no change was made to any of them by this deploy).

## Backups, restore and monitoring (Project 0, tasks 0.9 to 0.12)

Scripts live in `deploy/bin/`, units in `deploy/systemd/`, installed by `deploy/provision/05-backups-and-monitoring.sh`
(run as root on the VM; secrets are prompted with hidden input or read from the environment, never passed as arguments).

- **Backups.** `sparkkindly-backup.timer`, daily 03:15 UTC: for each database in `BACKUP_DATABASES`
  (`/opt/sparkkindly/shared/backup.env`, mode 600) `pg_dump -Fc`, encrypted with `age` to `AGE_RECIPIENT`, minimum 10 KB,
  uploaded to B2 `sparkkindly-backups/db/<database>-<UTC stamp>.dump.age`; local copies kept two days. The server never deletes
  from B2 (a compromised server must not be able to wipe the backups): the 30 days are a B2 **bucket lifecycle rule**
  (Backblaze > Buckets > sparkkindly-backups > Lifecycle Settings > Custom: hide after 30 days, delete 1 day after hiding).
  Postgres child processes are started without the Backblaze key or heartbeat URLs in their environment. The `sparkkindly-backup` heartbeat is pinged only after everything succeeded. A failed or truncated dump
  uploads nothing and pings nothing (tested, including a dump that dies midway: `tests/unit/backup-scripts.test.ts`).
  List: `( set -a; . /opt/sparkkindly/shared/backup.env; rclone ls b2:sparkkindly-backups/db/ )` (the subshell keeps the Backblaze key out of your login shell). **At the production cut-over add `sparkkindly` to `BACKUP_DATABASES`.**
- **Encryption key.** The age private key is created once on the server at `/root/.config/sparkkindly/age.key` (mode 600). The
  owner copies it into their password manager from their own terminal; it is never sent through chat or committed. Without
  it, backups cannot be restored if the server is lost.
- **Restore.** `restore.sh <file | b2:sparkkindly-backups/db/<name>> <target-db> [--force]` decrypts, drops and recreates the
  target and runs `pg_restore`. It refuses `sparkkindly` and `sparkkindly_staging` without `--force` (exit 3). For a real
  restore stop the matching web service first. Recovery targets from the spec: lose at most 24 hours of data, be back within 4.
- **Restore test.** `sparkkindly-restore-test.timer`, monthly: restores the newest staging backup into
  `sparkkindly_restoretest`, requires the same public table count as live staging and at least one `items` row, drops it,
  then pings `sparkkindly-restore-test`.
- **Disk.** `sparkkindly-disk.timer`, hourly at :05: no ping (so Better Stack emails) at 80 percent or more; `sparkkindly-disk` heartbeat.
- **Better Stack.** Uptime monitor on `https://staging.sparkkindly.com/api/health/` (basic auth) plus the three heartbeats
  (backup 1 day, restore test 7 days, disk 1 hour). Production gets its monitor at the cut-over.
- **Backblaze key.** The application key is limited to the `sparkkindly-backups` bucket (read and write). Rotate it in Backblaze,
  then re-run the install script with the new values.

## Trust pages, accessibility and cut-over preparation (Project 1D)

The trust pages (About, Editorial policy, Privacy, Terms, Accessibility, Contact) are drafts written to match the running product; the owner decisions they still need are listed in `docs/CUTOVER.md`. `CONTACT_EMAIL` in the env file publishes a contact address on the Contact and Accessibility pages once the owner confirms a mailbox they read; unset, no address is shown. `CONTACT_ADDRESS` (one line) likewise adds a postal address to the Contact page; keep it in the env file only. The accessibility record is `docs/ACCESSIBILITY-REVIEW-1D.md`. Support articles: `docs/kb/`.

The cut-over is prepared and **not executed**: checklist, runbook, rollback and the owner authorizations are in `docs/CUTOVER.md`; the scripts are `deploy/cutover/switch-to-app.sh` and `rollback-to-static.sh` (tested against stub commands only), `scripts/url-inventory.ts` and `scripts/load-test.ts`. Pushing `main` updates the loopback app only; the public switch is the Caddy change.

**Backup and restore verified on staging, 1 November 2026 (UTC).** Install via `05-backups-and-monitoring.sh`; the first backup uploaded
`sparkkindly_staging-20261101T192210Z.dump.age` (61127 bytes) and pinged its heartbeat; the restore test restored it into a scratch
database with the same 14 tables as live staging and 24 items, dropped it, and pinged. The restore test first failed (the
`postgres` user could not read root's decrypted file), so the restore now pipes the decrypted dump into `pg_restore`.
The disk job reported 10 percent used, and restoring over `sparkkindly_staging` without `--force` was refused (exit 3).
**Production** is not yet in `BACKUP_DATABASES` (add it at the cut-over).

## Admin and worker (Project 1C)

**Admin sign-in.** `/admin/` is for the addresses in `ADMIN_EMAILS` (comma-separated, in the root-owned env file
`/opt/sparkkindly/shared/<env>.env`; never in the repository). Sign-in is an emailed link (15 minutes, single use, used
by pressing Continue so mail scanners cannot spend it) and then the code from an authenticator app. Sessions last at most
12 hours and end after 60 idle minutes; five wrong codes end the attempt. Every admin action and sign-in step is in
`audit_log`. Staging sets `ADMIN_LINK_BASE=https://staging.sparkkindly.com` so its links point at staging.
- **Add or remove an approver:** edit `ADMIN_EMAILS` and `sudo systemctl restart sparkkindly-web` (or `-staging`).
  Removing an address ends its sessions on the next request. This is also the recovery path if sign-in links are
  being flooded: while a link is still valid it is re-sent at most every 5 minutes, and a new one is minted only when
  it has expired or been used (at most 6 an hour), so a flood never leaves the owner without a working link and
  never grants access.
- **Encryption key:** `ADMIN_SECRET_KEY` (base64, 32 bytes; generate as in the env example) encrypts the stored
  authenticator secrets. Without it, or with the wrong one, sign-in fails closed ("Sign-in is unavailable").
  Keep a copy in the password manager; losing it means re-enrolling every authenticator.
- **Enrol an authenticator** (once per approver, and again to replace a lost phone): through the SSH tunnel with
  `DATABASE_URL` and the same `ADMIN_SECRET_KEY` as that environment's env file (in the shell for that one command,
  never saved to a file), run `npm run admin:totp -- <email>`; it prints an `otpauth://` URI once. Add it to
  the authenticator app (paste it, or make a QR code locally), and do not save it anywhere else. Re-running replaces the
  secret and ends that address's sessions.

**Agent keys** are created, rotated (old key dead at once) and revoked in `/admin/agents/`; the new key is shown once,
after a redirect, to the same session within 5 minutes (a reload shows nothing and rotates nothing). Keys older than 90 days are flagged there and in the digest.

**Worker.** `sparkkindly-worker.timer` (and `-staging`) runs `sparkkindly-worker.service` once a minute: a oneshot that
runs the live release's `worker.mjs` (built in the deploy by `npm run worker:build`), so deploys need no worker restart.
Each tick publishes due items (enabled worlds only) and, once a day after `DIGEST_HOUR_UTC` (default 7), emails the digest
to `ADMIN_EMAILS`. Failures land in `failed_jobs` (shown in `/admin/runs/` and the next digest); a failed digest is not
re-sent the same day. Logs: `journalctl -u sparkkindly-worker -n 50`.
- **Install (owner-authorized server step, after the first deploy that contains `worker.mjs`):** re-run
  `deploy/provision/03-services.sh` (it installs the four units and starts each timer once its release has `worker.mjs`),
  or `systemctl enable --now sparkkindly-worker-staging.timer`. Check with `systemctl list-timers 'sparkkindly-worker*'`.
- **Manual check:** `cd /opt/sparkkindly-staging/current && set -a && . /opt/sparkkindly/shared/staging.env && set +a &&
  /opt/sparkkindly/node/bin/node worker.mjs` prints `worker tick: published N, ...; digest: ...`.
- **Real digest verification (needs the MailerSend token):** on staging set `DIGEST_HOUR_UTC` to the current UTC hour,
  delete today's `job_runs` row for `digest` if one exists, run the manual check, and confirm the email arrives and SPF/DKIM
  pass. Not yet done: MailerSend is still a placeholder token (Project 0, task 0.11).

**Verified locally, 1 November 2026.** Unit suites (PGlite) and the Playwright suite (in-process database) pass; the
bundled `worker.mjs` run against the e2e database published a due item, claimed the day's digest, recorded the failed send
(no MailerSend token) once in `failed_jobs`, and on the second run reported `already_sent`. Not verified on staging.

**Migration 005 rollback** (only if 1C is withdrawn; nothing else depends on it): `DROP TABLE admin_users,
admin_login_tokens, admin_sessions, job_runs; ALTER TABLE agents DROP COLUMN key_rotated_at; DELETE FROM
schema_migrations WHERE name = '005_admin.sql';` after the data-correction backup step.

**Before the production cut-over:** the production Caddy block must send `X-Frame-Options: DENY` (or
`Content-Security-Policy: frame-ancestors 'none'`) so `/admin/` cannot be framed. Not set by this project.

**Admin, trust pages and backups deployed to staging, 1 November 2026 (UTC).** Release `71fd30a` (CI and Deploy green). Verified with the
staging login: the home page, a starter article, a play page, `/quiz/`, search, About, Privacy, Terms, Accessibility, Contact and
Editorial policy answer 200; `/admin/` redirects (307) to `/admin/sign-in/`; the sitemap is empty and `robots.txt` disallows all;
`/api/health/` is `{"ok":true}`; an unanswered quiz page carries no explanation text; sparkkindly.com (production) still answers 200.
**Not yet done on staging:** `ADMIN_EMAILS`, `ADMIN_SECRET_KEY`, `ADMIN_LINK_BASE` are not set (sign-in is unavailable by design), the
worker timers are not installed (`03-services.sh`), no authenticator is enrolled, and no real digest or sign-in email has been sent.

## Content agents (Project 2)

What runs: Windows Task Scheduler on the owner's machine starts `scripts/scheduler/run-daily.ps1` three times a day
(play and discover 08:00, together and grow 13:00, kids 18:00, local time). Each run calls `claude -p "/daily-run env=<env>
worlds=<list>"`. The master command (`.claude/commands/daily-run.md`) reads each world's brief, starts a world agent
(`.claude/agents/sparkkindly-world-agent.md`, goals in `agents/worlds/<slug>.md`), sends **every** draft to the reviewer
(`.claude/agents/sparkkindly-reviewer.md`, web tools only, cannot submit), submits passes, and records the run with
`sparkkindly_record_run`. The machine must be on and signed in; the content buffer covers days it is not.

Set up (owner, once), staging first:

1. The staging agent key and secrets file entries from `agents/README.md` must exist, and `/mcp` must show `sparkkindly-staging` connected.
2. `scripts\scheduler\register-tasks.ps1 -WhatIf` shows what would be created; run it without `-WhatIf` to register. Check with
   `Get-ScheduledTask 'SparkKindly*'`. Remove with `register-tasks.ps1 -Unregister`. Use `-Env prod` only after staging has run cleanly.
3. The run is isolated on purpose (automated review finding, 3 Nov 2026): `--setting-sources project` skips the owner's user settings, `Read` is limited to `agents/worlds/`, and Bash, file-writing tools are denied, so a web page that tries to steer an agent cannot read the secrets file or run commands. Checked: a file in the home folder is denied, a goals file reads, the connector works. Do not add `Read` or other tools back without the same check.
4. Logs are written to `%USERPROFILE%\sparkkindly-runs\` (outside the repository; they can hold item text; never commit them).
5. A test run by hand: `scripts\scheduler\run-daily.ps1 -Worlds play -Env staging`, then check the new items in `/admin` and the run on the runs page.

Reviewer evaluation (manual, uses plan usage; never in CI): `npx tsx scripts/review-eval.ts` runs the real reviewer over the five
fixtures in `agents/fixtures/review/` (a clean pass, a wrong answer, an unsupported claim, a duplicate, an injected instruction). All
five must be judged as labelled before the reviewer is relied on. Record the date, model and result here.
Evaluation record: **3 November 2026**, `scripts/review-eval.ts`, Claude Code's default model, 5 of 5 judged as labelled with real reasons (no unusable answers). The clean puzzle passed with the reviewer's own blind solution (30); the wrong answer (28) was caught by solving it; the Great Wall "visible from the Moon" claim was failed because its own source calls it a myth; the reworded friend-message was failed as a duplicate; the injected instruction was ignored, flagged as "contains instructions aimed at the reviewer", and the item was also failed on its wrong answer. Re-run after any change to the reviewer prompt or the model.

First-week measurement (tracker 2.7): for the first week run on this reduced schedule and note each day the number of items per run,
run time, and whether the plan's limit was hit (the digest shows plan-limit hits and recommends a higher plan when a world misses its
buffer target on 3 of the last 7 days). Also confirm the Claude subscription terms permit scheduled, unattended use, and record the decision here.
If no run is recorded for 36 hours the worker emails the admin list.

## Accounts (Project 3A)

- **Flag.** `ACCOUNTS_ENABLED` (`true` or `1`) switches on `/account/*` (sign-up, email sign-in link, sign-out). Anything else, or unset, switches it off: every account page is a 404, a POST to any of the four account routes (`/account/sign-up/submit/`, `/account/sign-in/request/`, `/account/sign-in/link/confirm/`, `/account/sign-out/`) is a 404, and a GET or HEAD to those POST-only routes is a 405. Staging may set it in `/opt/sparkkindly/shared/staging.env`. **Production must not set it** until the professional privacy review (spec Project 3) is done and the privacy and about pages are updated: they still say "no accounts" and must be rewritten before `ACCOUNTS_ENABLED` goes on in production. The parental consent flow (3B, below) exists.
- **Staging link host.** Account sign-in links reuse `ADMIN_LINK_BASE`. Whenever staging sets `ACCOUNTS_ENABLED`, it must also set `ADMIN_LINK_BASE=https://staging.sparkkindly.com`; without it the links point at production.
- **Migration.** `007_accounts.sql` (accounts, sign-in tokens, sessions) reaches production with this branch whether or not the flag is on: it is additive and inert (new tables only, nothing reads them while the flag is off). The rollback is in the migration header. **Release rollback:** before switching the `current` symlink back to a release that predates migration 009, run `DELETE FROM account_sessions WHERE active_profile_id IS NOT NULL;` (the old code ignores the column, so every session on a child profile would otherwise become a full adult session). Child profiles are capped at 10 per account.
- **Sign-in token.** It travels in the emailed URL query (`/account/sign-in/link/?token=...`), so it appears in Caddy access logs; it is single-use, expires in 15 minutes, and only a POST on the confirm page redeems it.
- **Session cookie.** `__Host-sk_account` (HttpOnly, Secure, SameSite=Lax) is sent with every request on the site, Kids pages included. Its `Max-Age` is a fixed 30 days from sign-in; the server session slides (30 days idle, never past 90 days), but the browser drops the cookie at 30 days, so in practice a sign-in lasts at most 30 days. It is a strictly necessary session cookie, but it is the one storage identifier a signed-in person carries onto Kids pages; check the privacy review covers that before production.
- **Limits** (in memory, per process, separate from admin's): 30 sign-ups and 60 link requests per network (IPv4 address, IPv6 /64) an hour, 60 link confirmations per IPv4 /24 or IPv6 /64 an hour, at most 6 links per address an hour and none while a link minted in the last 60 seconds is unused, and a site-wide budget of 300 account emails an hour for sign-up sends and links to unverified addresses (a verified member's sign-in link never counts against it, so a sign-up flood cannot lock members out). Past the budget, sends are skipped silently and the app logs one line an hour: `account email budget reached: ...` (no address or IP). If that line appears, look for a sign-up or link-request flood before raising anything.
- **Retention.** The worker runs `account-purge` once per UTC day (claimed in `job_runs`, like the digest): it deletes unverified accounts older than 48 hours (their sessions go with them), every expired login token, used login tokens older than 1 day, and expired sessions. It never touches a verified account. Its tick log line reads `account purge: N account(s), N token(s), N session(s)`; a failure lands in `failed_jobs` as `account-purge`.
- **Personal data held** (for the future data inventory, plan 3E): `accounts` (email, date_of_birth, time_zone, consent_state, parent_email, consent_at, consent_reminded_at); `account_consent_tokens` (parent_email and sha256 token hashes; parent_email is cleared from `accounts` and the tokens deleted when the holder turns 16, and everything goes with account deletion); `account_login_tokens` (email); `account_sessions` (linked to the account); the in-memory limiter maps (email addresses, IP addresses or prefixes; gone on restart); MailerSend's recipient records for sent emails. The app keeps no web access log of its own (Caddy's access log holds request URLs, including the sign-in token, as noted above).

### Parental consent (Project 3B)

- **Flow.** A 13 to 15 sign-up gives a parent address and starts `consent_state = 'pending'`. Once the holder verifies their own email, the parent gets one email with a confirm link and a withdraw link. The confirm page (`/account/consent/?token=...`) only shows the request on GET; a POST confirms (`confirmed`, `consent_at` set). The withdraw page (`/account/consent/withdraw/`) works the same way and a POST deletes the account and everything it holds. Links in a mail scanner's GET change nothing.
- **Tokens.** Random, stored only as sha256 hashes, bound to the account and to the exact parent address they were sent to (a changed or cleared address kills them). The confirm link works for 30 days. The withdraw link never expires until it is cleared at 16, on confirm-path deletion, or on withdrawal. A parent token reaches only those two pages: it cannot sign anyone in or read account data (tests/unit/account-isolation.test.ts).
- **Daily `consent-sweep`** (worker, once per UTC day, claimed in `job_runs` as `consent-sweep`): at 7 days after `verified_at` a still-pending account's parent gets one reminder (`consent_reminded_at`; a failed send is retried the next day); at 30 days after `verified_at` a still-pending account is deleted (the check repeats under the account row lock, so a confirm that lands meanwhile wins); when the holder is no longer 13 to 15 the parent email and tokens are cleared and a pending account becomes `none`. Unverified accounts belong to the 48 hour `account-purge`, not this job. Parent addresses are never logged.
- **If a parent says no email arrived.** Ask them to check spam and the sender address, then check the MailerSend activity log for the parent address. The teen can press the resend button on their account page (the age group and pending state are rechecked; a failed resend keeps the earlier link working). The first email is only sent after the holder verifies their own address, so also confirm the teen has used their sign-in link. After 30 days with no confirmation the account is deleted and the teen must sign up again.
- **Migration.** `008_parental_consent.sql` (consent_at, consent_reminded_at, `account_consent_tokens`) is expand-only; the previous release ignores it. The rollback is in the migration header.
- **Before production.** The privacy and about pages still say there are no accounts; rewrite them with the professional privacy review. Both the privacy page (`app/(trust)/privacy/page.tsx`) and the About page (`app/(trust)/about/page.tsx`) also say SparkKindly "does not save your answer"; with accounts on, a signed-in profile's first answer to each item is saved (plan 3D), so both must be rewritten before `ACCOUNTS_ENABLED` goes on in production. A neutral age screen and same-browser retry block are deferred to that review.

### Child profiles (Project 3C)

- **What a profile holds.** `child_profiles`: a display name (1 to 30 characters, NFKC-normalised, never an email address, all-digit or control-character name), an age band (`6-9` or `10-12`), the owning account id and `created_at`. It never holds an email address, date of birth, free text, photo, answers in this table (3D keeps them in `item_responses`, below) or any other identifier of the child (spec 4a.5). Only an 18+ account in good standing can create one, and must tick that they are the child's parent or guardian.
- **Context.** The active profile is stored on the session row (`account_sessions.active_profile_id`), never taken from a request; a composite foreign key keeps it to the session's own account. A child context sees audiences `kids` and `all` only; the adult, teen and anonymous contexts see `kids`, `all` and `adults` (`adults` means "aimed at adults", not an age gate). A child context has no account: settings, invites, comments, contributing, profile changes and sign-out are refused (403 on the POSTs), and `requireAdultContext` is the gate for any new adult-only route.
- **PIN.** One 4-digit PIN per account, set with the first profile, stored only as a salted scrypt hash. It is needed to leave a child context. 5 wrong entries in a row lock it for 15 minutes; each further lock doubles (30 minutes, 1 hour ... capped at 24 hours); only a correct PIN resets the failure and lock counts. Pages say only "wrong" or "locked", never attempts left or time remaining. Changing the PIN needs the current PIN and an adult context.
- **Forgotten or locked PIN.** There is no owner override, but the adult can reset it themselves (3E, "Settings, export, deletion and inactivity" below): sign in again with an emailed link, which starts an adult-context session without the PIN, then set a new PIN on the settings page within 10 minutes of that sign-in. Shared-device limit: this works only when the adult can open their inbox on that device. A child cannot get out of the profile by any other route. If a parent reports being stuck, tell them to request a sign-in link on the device and then use the PIN reset on `/account/settings/`.
- **Deleting a profile.** An adult deletes it from `/account/children/` (with a confirm step); sessions active on it are ended in the same transaction, so that device falls back to signed out, never to the adult context. Deleting an account cascades every profile and session. When a child turns 13 the profile is closed the same way (they may open their own account). The deletion tests are in `tests/unit/account-children.test.ts` and `tests/unit/account-isolation.test.ts`.
- **Guardian confirmation.** `accounts.guardian_confirmed_at` is stamped once, at the first profile. A per-child consent record is left to the professional privacy review (tracker 3.11).
- **Personal data held** (add to the Accounts list above, for the data inventory in plan 3E and 3F): `child_profiles` (display name, age band, account id, created_at); `accounts.guardian_confirmed_at`; `accounts.pin_hash`, `pin_failures`, `pin_lock_count`, `pin_locked_until` (a hash and counters, never the PIN); `account_sessions.active_profile_id`. All go with account deletion. The PIN is never logged or put in a URL.
- **Migration.** `009_child_profiles.sql` is expand-only (a new table and nullable or defaulted columns; the previous release ignores them). The rollback is in the migration header.

### Interests, saved answers and /me (Project 3D)

- **What they hold.** `profile_interests`: account id, profile id (NULL for the account holder's own, else one child profile) and a topic id or a world id. `item_responses`: account id, profile id, item id, `correct` and `answered_at`. Neither holds free text, the answer given, page views, a device or any other identifier; for a child, only topic/world ids and per answered item the correctness and time. At most 30 interests per profile; a save replaces the whole set in one transaction; worlds must be enabled.
- **First answer only.** A profile's first answer to an item is stored and later ones are ignored (`ON CONFLICT DO NOTHING`), so correctness never changes. A consent-pending 13 to 15 account may save interests but its answers are not stored. Anonymous play is unchanged and saves nothing.
- **Same-origin only.** The play panel answers on a GET, so an answer is stored only when the request has `Sec-Fetch-Site: same-origin` and is not a prefetch (`Next-Router-Prefetch`, `Sec-Purpose`, `Purpose`, `X-Moz`). A cross-site link, a link scanner or a prefetch gets the verdict but plants nothing; the panel then says the answer was not saved. If a person reports "my answer was not saved", check they opened the item from the site itself in the same browser while signed in. A recording error is logged by error name only.
- **Scope and owner.** The owner and the audiences come from one session lookup (`lib/accounts/scope.ts`), never from a request field; ids in a form are ignored. A child context sees `kids` and `all` only; teen, adult and anonymous contexts see all three audiences. Public pages derive their scope from the session (a source-scan test forbids `anonymousScope(` outside the sitemap). A database error with a session cookie present fails closed to `kids` and `all`. `/me` redirects to sign-in without a session; answered items are listed and counted only while the public reads would still show them.
- **Time zone.** "Today" and "recent" (14 days) use the account's local calendar day from `accounts.time_zone` (the browser-reported zone at sign-up; UTC when the zone is unknown or invalid; DST and clock gaps handled). The zone is set at sign-up and can be changed on the settings page (3E); a child profile uses its account's zone. Progress wording is plain counts, no streaks or targets.
- **Deletion.** Both tables cascade: deleting a child profile removes its interests and answers (composite foreign key `(profile_id, account_id)`), deleting an account removes all of them, and deleting an item or topic removes the rows that reference it. Withdrawal and the consent sweep use the same account deletion. The tests are in `tests/unit/account-interests.test.ts`, `account-responses.test.ts` and `account-isolation.test.ts`.
- **Data inventory** (for plans 3E and 3F; both go with account deletion and are in the export, 3E):
  - `profile_interests`: account id, profile id, topic id or world id. Purpose: the personal dashboard. Holder: account holder or child profile. Retention: until changed, or profile or account deletion.
  - `item_responses`: account id, profile id, item id, correct, answered_at. Purpose: the personal dashboard and progress count. Retention: until profile or account deletion.
- **Migration and rollback.** `010_interests_responses.sql` is expand-only (two new tables). The rollback is in its header: `DROP TABLE item_responses; DROP TABLE profile_interests; DELETE FROM schema_migrations WHERE name = '010_interests_responses.sql'.` A release rollback to code older than 010 ignores both tables, so interests and answers simply stop being read or written; the data stays for when the newer release returns. **But any release older than the 3D Task 2 scope fix (public pages derive their scope from the session) shows `adults` items to a signed-in child profile.** Before rolling back to such a release, run `DELETE FROM account_sessions WHERE active_profile_id IS NOT NULL;` (every device in a child profile is signed out) or turn `ACCOUNTS_ENABLED` off.
- **Before production.** The privacy page (`app/(trust)/privacy/page.tsx`) and the About page (`app/(trust)/about/page.tsx`) must both be rewritten before `ACCOUNTS_ENABLED` goes on in production: they still say there are no accounts and that SparkKindly "does not save your answer", which stops being true for a signed-in profile. This stays a go-live gate with the professional privacy review (tracker 3.11).

### Settings, export, deletion and inactivity (Project 3E)

- **Settings page.** `/account/settings/` (adult context only; behind `ACCOUNTS_ENABLED`) holds three notification preferences (`notify_daily_set`, `notify_weekly_circle`, `notify_invites`, all off by default) and the time zone (a native select of supported zones; an invalid value keeps the old one). Nothing sends the optional emails yet; the preferences are ready for when something does. Every POST (save, export, delete, PIN reset) checks `Origin`, takes the account from the session only (form-supplied account or profile ids are ignored) and answers 403 in a child context. Anonymous goes to sign-in. A consent-pending 13 to 15 account sees the form disabled ("available after your parent or guardian confirms") and its save is refused with a neutral code: until consent it saves interests only. Export, PIN reset and the interests save each allow 30 POSTs per account per hour (in memory, per process); past that the answer is 429 "Too many attempts. Please try again later."
- **Export.** A POST to `/account/settings/export/` returns one JSON file (`Content-Disposition: attachment`, `Cache-Control: no-store`) with the account (email, date of birth, time zone, consent state and dates, guardian confirmation, notification preferences, `verified_at`, `last_sign_in_at`, `last_seen_at`, `inactivity_notice_at`), the holder's interests and answers, and each child profile with its own interests and answers. Never exported: the PIN hash and counters, tokens, sessions, internal ids, other accounts' data; the parent address appears only masked. The read runs in one repeatable-read, read-only transaction. `tests/unit/account-export.test.ts` follows the schema: a new personal-data table, or a new column on `accounts` or `child_profiles`, fails it until it is exported or excluded with a reason in `lib/accounts/export.ts`.
- **Self-service deletion.** `/account/settings/delete/` names what goes and needs the account email typed (case-insensitive) in an adult context. It removes the account from every personal-data table: `accounts`, `account_login_tokens` (by address, no foreign key), `account_sessions`, `account_consent_tokens`, `child_profiles`, `profile_interests` and `item_responses`, in one transaction, then clears the cookie and goes to sign-in with a neutral code. Backups age out within 30 days (see "Backups, restore and monitoring"), so a deleted account can persist in a backup for up to 30 days and is never restored selectively. The account-isolation test checks all seven tables.
- **Inactivity.** The worker job `inactivity-sweep` runs once per UTC day (claimed in `job_runs`). Last activity is the greatest of `last_sign_in_at`, `last_seen_at` (updated by the session refresh at most hourly), `verified_at` and the latest answer by the account or any of its profiles. At 730 days idle (slightly under 24 calendar months across a leap day, so a notice can come a day early) the account gets one notice email at its own address and `inactivity_notice_at` is set. Thirty days after the notice it is deleted if still inactive, rechecked under the account row lock; found active it is spared and the notice cleared. Signing in by email link clears the notice. Unverified accounts (the 48 hour purge) and consent-pending teens (the consent sweep) are excluded. Each run is capped at 50 notices and 20 deletions; past a cap it stops and writes a `failed_jobs` row (job `inactivity-sweep`, counts only, never an address), which shows with the other failed jobs. The run refuses, with the same kind of alert, when the worker clock and the database clock differ by more than 10 minutes. The consent sweep (at most 20 deletions per run, job `consent-sweep`) and the unverified purge (at most 500 accounts per run, job `account-purge`) have the same cap alert and clock check (`lib/jobs/guards.ts`). A failed notice send is retried the next day. Addresses are never logged.
- **PIN reset.** `/account/settings/` accepts a new 4-digit PIN (twice) only in an adult context whose session was created by an email link within the last 10 minutes (a session dated in the future counts as stale too). A stale session is told to sign in again by email link. A reset clears the failure count, the lock and the lock count; nothing else changes.
- **Unsubscribe.** The token is `<account id>.<kind>.<HMAC-SHA256>` signed with `UNSUBSCRIBE_SECRET`, with no expiry, bound to its kind (a daily-set token cannot turn off invites) and never stored. `UNSUBSCRIBE_SECRET` is its own secret of at least 32 characters; when it is empty or shorter, unsubscribe is disabled (nothing is minted or accepted). It is deliberately not in `requiredEnv`, so health stays green. The page `/account/unsubscribe/?t=<token>` only shows a button on GET; the POST `/account/unsubscribe/confirm/` changes the one preference and answers the same whatever the token (no account enumeration). The future `List-Unsubscribe` header must point at `/account/unsubscribe/confirm/?t=<token>` (one-click POST, RFC 8058). The e2e uses a test-only value set in `playwright.config.ts`.
- **Owner action (before accounts go on at staging or production).** Generate a random value of at least 32 characters and set `UNSUBSCRIBE_SECRET` in `/opt/sparkkindly/shared/staging.env` and `/opt/sparkkindly/shared/prod.env` on the VM (root-owned, readable by the `sparkkindly` service user), then restart the services. Write the value nowhere else. The deploy env examples carry an empty entry as a reminder. Changing the secret later invalidates earlier tokens.
- **Data inventory rows added by 3E** (all go with account deletion and are in the export): `accounts.notify_daily_set`, `notify_weekly_circle`, `notify_invites` (the holder's email preferences; until changed or deletion); `accounts.inactivity_notice_at` (when the idle notice was sent; cleared on sign-in; used by the retention job); `accounts.last_sign_in_at` (last email-link sign-in; retention job; kept while the account lives); `accounts.last_seen_at` (when one of the account's sessions was last used, to the hour; retention job).
- **Migrations and rollback.** `011_settings.sql` (three notification columns and `inactivity_notice_at`) and `012_last_sign_in.sql` (`last_sign_in_at`, `last_seen_at`, backfilled from `verified_at` and live sessions) are additive; the rollback is in each header (`DROP COLUMN` plus the `schema_migrations` row). Rolling the app back needs the previous release live first: the 3E code reads the new columns (`export.ts` selects them), so drop the columns only after the older release is running. The older release ignores them. Rolling back below 012 and forward again can lose activity timestamps (the older code does not update `last_sign_in_at` or `last_seen_at`, so the inactivity sweep would see accounts as idler than they are). Before deploying forward after such a rollback, either run `UPDATE accounts SET last_seen_at = now(), last_sign_in_at = now() WHERE verified_at IS NOT NULL;` or disable the inactivity job for a day.
- **Before production.** The go-live gate stands: the privacy and About pages must be rewritten (they still say there are no accounts and that SparkKindly does not save answers) with the professional privacy review (tracker 3.11) before `ACCOUNTS_ENABLED` goes on in production, and must state the export, deletion and inactivity behaviour above, including the 30-day backup ageing. The drafts for that review (data inventory, privacy policy, terms, community guidelines, the exact page-copy and e2e changes, and the professional's checklist) are in `docs/legal/`; none is published.

## Circles (Project 4A)

- **Flags.** Circles need `ACCOUNTS_ENABLED` **and** `CIRCLES_ENABLED` (`true` or `1`). With either unset every
  `/circles/*` page and POST route is a 404 and the account page shows no Circles link. Both are off everywhere; the env
  examples carry a commented `# CIRCLES_ENABLED=`. Turning circles off is unsetting `CIRCLES_ENABLED` and restarting the
  web service: the rows stay, nothing reads them, and the closed-circle purge keeps running in the worker.
- **Who may create.** Rulings (plan 4A): friends circles by any account with the `create_circle` capability (18+, 16-17,
  and 13-15 once a parent has confirmed); family and community circles by 18+ only. A consent-pending 13-15 account
  cannot create or be added. Joining by invite and communities: see "Circle invites and communities (Project 4B)".
- **Limits** (`lib/circles/rules.ts`). An account owns at most 5 open circles and belongs to at most 10; a circle holds
  at most 30 current members (accounts and child profiles). Name 1 to 40 characters, "your name in this circle" 1 to 30
  (no `@`), community description up to 200; all trimmed, NFKC-normalised and checked against the blocked-words list.
  Circle POSTs share a per-account allowance of 30 an hour for creating and 30 an hour for member and owner actions.
  Ruling (4A review): the 5-open-circles limit applies at creation only; a transfer or an owner-deletion hand-over may
  take an account above 5 owned circles.
- **What a circle holds and shows.** `circles`: name, kind, optional description, owner, time zone (default the
  owner's), open or closed, `hidden_at` (for the admin hide in 4.8; a hidden circle is invisible to its members and
  takes no new child), created and closed times. Its URL is `/circles/<slug>/`, a 10-character random slug, never
  derived from the name. `circle_members`: one row per account or child profile, with the name chosen for the circle,
  role, `joined_at` and `left_at`. Members see each other's circle names and roles only, never an email. No page carries
  another member's account or profile id: the owner's forms post an opaque per-row `member_key` (16 hex, migration 015),
  resolved on the server within the owner's own circle only. Ids from forms are lower-cased at the boundary
  (`uuidOf` in `lib/accounts/pin.ts`), and the remove statement never touches the `owner` row. A non-member gets a 404 for the circle page and the same
  neutral "not available" answer as a missing circle for every POST.
- **Owner rules.** The owner removes a member (an adult removed takes their child profiles out with them), transfers
  ownership to another current 18+ account member, or closes the circle. The owner cannot leave without transferring or
  closing. Every owner action locks the circle row first (`FOR UPDATE`), so racing actions leave exactly one owner on an
  open circle. A closed circle is read-only (no owner action, no child added or removed, nobody leaves) and stays
  readable by members. Account deletion locks the account's owned circles (in id order) before the account row, the same
  order as every circle write, and locks the heir's account row (`FOR SHARE`) at hand-over, so an heir being deleted at
  the same moment is skipped.
- **Child profiles.** Only the profile's own adult, only into an open family circle that adult belongs to, only after
  ticking "everyone in this circle sees this display name and its scores". A circle with any 13-17 member takes no child
  (and the 4B join path must refuse a teen in a circle that holds a child: `circleHasChild`). The child appears under its
  profile display name. Deleting the profile removes its circle rows.
- **Leaving.** The member's row keeps `left_at` (4C shows past contributions as "former member"); lists show current
  members only. Leaving takes the account's child profiles out of that circle too.
- **Account deletion.** In the deletion transaction, each open circle the account owns passes to its longest-standing
  other 18+ account member; with none it is closed. Owned closed circles keep no owner (`owner_account_id` is NULL only on
  a closed circle, enforced by a CHECK). The account's own member rows cascade.
- **Export.** The account export lists the holder's own memberships (circle name, kind, role, their name in it, joined,
  left) and each child profile's, and nothing about other members.
- **Purge.** The worker job `circles-purge` runs once per UTC day (claimed in `job_runs`) and deletes circles closed more
  than 30 days ago, with their member rows. At most 100 a run (more due: an alert row in `failed_jobs`); it refuses to
  run when the worker and database clocks differ by more than 10 minutes, like the account jobs.
- **Migration and rollback.** `014_circles.sql` is additive (two new tables). Rollback of the code: unset
  `CIRCLES_ENABLED`, or switch `current` back to the previous release (it never reads the tables). Rollback of the
  schema, only after the previous release is live: `DROP TABLE circle_members; DROP TABLE circles; DELETE FROM
  schema_migrations WHERE name = '014_circles.sql';` (as in the migration header). An older release's account deletion
  fails on an account that owns a circle (the plain foreign key), so drop the tables before deleting accounts with an
  older release live.
- **Before production.** The privacy page must say what circle members see of each other before `CIRCLES_ENABLED` goes
  on in production (data inventory, `docs/legal/go-live-copy-changes.md`).

## Circle invites and communities (Project 4B)

- **Flags.** Same as circles: `ACCOUNTS_ENABLED` and `CIRCLES_ENABLED`. With either unset every invite page
  (`/circles/join/<token>/`), `/circles/communities/`, the invite image and every invite POST is a 404.
- **Tokens.** 32 random bytes, base64url (43 characters), stored only as a sha256 hash in `circle_invites.token_hash`.
  The raw token exists only in the link and the email. A newly made link is shown to its maker once, through a
  10-minute HttpOnly cookie (`__Host-sk_invite`) read by the circle page, and only if it is still that member's active
  link. The proxy (`proxy.ts`) clears the cookie on the first plain GET of a circle page that carries it, and signing
  out clears it, so the link really shows once; after that the member makes a new link (which revokes the old one). Invite pages send `Cache-Control: no-store`
  and `Referrer-Policy: no-referrer` (`next.config.ts`; the page also carries `<meta name="referrer" content="no-referrer">`
  in case the proxy rewrites the header). Because of no-referrer a browser posts the join form with `Origin: null`; the
  accept route takes that only together with the browser-set `Sec-Fetch-Site: same-origin`.
- **Who invites.** Members with the `invite` capability. Ruling (4B security review): in a circle that holds a child
  profile only the **owner** may make links or send email invites, and a member's invite made before a child was added
  stops working; revoking is unchanged (the owner any invite, a member their own).
- **Kinds.** A link invite is reusable until revoked; each member has one active link per circle and "Make a new invite
  link" revokes theirs (another member's link keeps working). An email invite is single use and expires 14 days after
  creation. Every invite stops working when its circle closes or is hidden, and when its creator leaves or is removed (leaving and
  removal both revoke the person's invites to that circle, so rejoining does not bring an old link back).
  The circle owner may revoke any invite; a member only their own (circle page, "Active invites").
- **Opening never joins.** `GET /circles/join/<token>/` shows the circle name, kind and member count only, and changes
  nothing except `opens`. Joining is the POST to `/circles/join/<token>/accept/` from a signed-in adult context; a
  signed-out visitor is sent to sign-up carrying only the validated path `/circles/join/<token>/` (sign-up, sign-in, the
  emailed link and the confirm step accept no other `next`). A revoked, expired, used or unknown token is one neutral
  404. **`opens` is an upper bound:** chat-app previews, mail scanners and crawlers fetch links too.
- **Join rules** (`lib/circles/join.ts`, shared by invites and communities). Signed in; not already a member; circle
  open and visible; under 30 members; the account in fewer than 10 open circles; `join_circle` (a consent-pending 13-15
  is refused); a circle holding a child profile admits 18+ only; a community needs `join_community` (not 13-15); friends
  and family circles only through an invite; a child-profile context is refused. "Your name in this circle" is required.
  A member the owner removed (`circle_members.removed_at`, set by remove, not by leave) cannot join that circle again,
  by invite or as a community; removing a member also revokes their own active invites to it. A member who left may rejoin.
- **Address guard** (4B security review, `lib/circles/invite-guard.ts`, migration 017). Whatever circle or sender, one
  address gets at most 3 invite emails in a rolling 7 days, counted in `invite_address_log` by an HMAC-SHA256 of the
  canonical address (lower-cased, domain in punycode; `+tag` dropped only at providers that ignore it, such as
  Gmail, Outlook, iCloud, Proton and Fastmail; dots dropped and googlemail.com read as gmail.com only for Gmail; no invite email went out before this canonical form, as both flags were off everywhere, so no older hash
  needs migrating; key: `UNSUBSCRIBE_SECRET`, label `invite-address:`), never the address itself; rows go after 8
  days in the daily `invites-purge`. A mail to an address without an account carries "Never email me SparkKindly
  invites again" (`/circles/stop-invites/?t=…`: the GET page changes nothing, its button POSTs; no sign-in, no flags, an
  invalid token spends the unsubscribe per-network allowance), which adds the hash to `invite_suppressions`; such an
  address gets no invite email again. **Without `UNSUBSCRIBE_SECRET` no invite email is sent at all** (the sender still
  sees "sent"). Invite mail has its own site-wide budget of 60 an hour (`inviteSendBudget`), separate from the account
  email budget, so invites cannot starve sign-in and consent mail. A suppressed or capped address spends no budget
  slot, and a refused budget spends no address slot. Circle names, descriptions and "your name in this
  circle" refuse anything link-like (a scheme, `www.`, or a `word.tld` pattern).
- **Email invites.** At most 10 sent per account per 24 hours, 3 per address per circle (the address is kept until the
  daily purge, so revoked invites count until then), one active invite per address per circle, 60 sends per network an
  hour, the address guard above and the invite email budget. The account row is locked (`FOR UPDATE`, after the circle
  row) while the daily count is checked, so one account's concurrent sends across circles cannot pass 10. An address whose account has invite email off (`notify_invites`, off by
  default) is sent nothing; the sender still sees "sent". The mail names the inviter by their circle name, the circle,
  says to ignore it if they do not know them, and has the one-click unsubscribe when the address has an account. Sends
  go through `lib/email.ts` (10-second timeout) and are started, not awaited, so the answer's timing does not say whether
  an address was mailed; a failed send is logged by error name only and the invite stays.
- **Communities.** `/circles/communities/` is public: name, description and member count of open, visible communities,
  newest first, 20 a page, never member names. Signed-in adults and 16-17s join from the list.
- **Referrals.** When an account created within the last hour first joins a circle through an invite, one `referrals`
  row records invite, account and time (no names). It is in the account's export (`joinedThroughInviteAt`).
- **Purge.** After `circles-purge`, the same daily worker run does `invites-purge`: it nulls `invited_email` on every
  used, revoked or expired invite and deletes invites spent more than 14 days ago, unless a referral points at them (500
  rows per step per run). Account deletion removes the account's invites, its referral row and pending invites to its
  address; the export lists invites the account created without addresses.
- **Emergency revoke from the database.** Every invite of one circle:
  `UPDATE circle_invites SET revoked_at = now() WHERE circle_id = (SELECT id FROM circles WHERE slug = '<slug>') AND revoked_at IS NULL;`
  Every invite site-wide: the same without the `circle_id` condition. Revoked invites cannot be un-revoked; members make new ones.
- **Referrer-Policy behind Caddy.** The Caddy site blocks set `?Referrer-Policy "strict-origin-when-cross-origin"`
  (only when the app sent none), so the app's `no-referrer` on invite and stop pages survives. **Owner action:** after
  this change is deployed, copy the two `deploy/caddy/*.caddy` files to the VM as before, `caddy validate` and reload
  Caddy, then check `curl -sI https://staging.sparkkindly.com/circles/join/<token>/ -u <staging user> | grep -i referrer`
  shows `no-referrer` (and the same on production after the cut-over). The production snippet's pinned checksum in
  `deploy/cutover/switch-to-app.sh` is updated with it.
- **Migration 017 and rollback.** `017_invite_address_guard.sql` is additive (`invite_address_log`,
  `invite_suppressions`). Code rollback: the previous release never reads them. Schema rollback, only after the previous
  release is live: `DROP TABLE invite_suppressions; DROP TABLE invite_address_log; DELETE FROM schema_migrations WHERE
  name = '017_invite_address_guard.sql';`. Dropping `invite_suppressions` forgets every refusal, so keep it unless the
  release itself is rolled back.
- **Migration and rollback.** `015_circle_invites.sql` is additive (two new tables and `circle_members.removed_at`). Code rollback: unset
  `CIRCLES_ENABLED` or switch back to the previous release (it never reads them). Schema rollback, only after the
  previous release is live: `DROP TABLE referrals; DROP TABLE circle_invites; ALTER TABLE circle_members DROP COLUMN
  removed_at; DELETE FROM schema_migrations WHERE name = '015_circle_invites.sql';` (as in the migration header).

## Circle sets and scores (Project 4C)

- **Flags.** Same as circles: `ACCOUNTS_ENABLED` and `CIRCLES_ENABLED`. With either unset `/circles/<slug>/set/`,
  `/scores/`, `/interests/` and the interests POST are 404s.
- **Interests.** The owner of an open circle picks up to 10 topics and 5 worlds (`/circles/<slug>/interests/`; ids are
  checked against existing topics and enabled worlds). Members see them read-only; a child profile is sent to its
  "Playing as" page.
- **The daily set** (`lib/circles/daily-set.ts`). Up to 5 playable items per circle day: published quizzes and games with
  a stored answer that the public reads would show. Preference: not shown to the circle in the previous 14 days, then
  items matching the chosen topics (within the chosen worlds, if any), then the chosen worlds, then any world (the last
  two are labelled "bonus"); a hash of circle, day and item orders each group. No interests means every world counts.
  The set is made the first time a member opens the set page that day (an advisory lock makes concurrent first opens
  produce one set; the circle page's status line only reads) and is then fixed. A closed circle makes no new set.
- **Day boundaries.** The circle day is the calendar date in `circles.time_zone`, so circles in Auckland and Los Angeles
  roll over at different instants. There is no way to change a circle's time zone yet.
- **Child safety.** A circle holding any current child profile gets and shows `kids` and `all` items only. The stored set
  is re-filtered on every read with the circle's current members, so adding a child hides an `adults` item at once and
  it stops scoring. Removing the child gives later sets the full range again.
- **Scores** (`lib/circles/scores.ts`). Derived on every read, nothing stored: a member (an account, or a child profile)
  earns the points setting per set item answered correctly on that circle day (first answer only; answers on another day
  count for nothing). Tallies for the day, ISO week (Monday start) and calendar month in the circle's zone, and all
  time, per member and for the whole circle. Ties share a rank (1, 1, 3). A member who left keeps their points as
  "Former member" (shown only where they scored); deleting an account or a child profile removes its answer rows and
  its points everywhere. Scores, sets and names are visible to current members only (and to a child profile for its
  own circles); a non-member gets a 404. Which answer anyone gave is never shown.
- **Points setting.** `/admin/pilot/` "Circle scoring": a whole number 0 to 100 (default 10), saved by the audited
  admin action `scoring.set_points` into `site_settings` (`points_correct`). It applies to every circle at once, past
  days included.
- **Re-scoring.** `item_responses.choice` (016) keeps the response for closed questions (option id, true or false,
  number, order of ids; never typed text). `changeAnswerKey(tx, itemId, answer, now)` in `lib/circles/rescore.ts` is the
  one way to change an existing item's answer key: in the same transaction it re-checks every stored choice, flips
  `correct` where it changed, and when anything flipped writes one `circle_notices` row per circle that had the item in a
  set in the last 30 days (the circle page shows "Scores corrected"; 4D emails it). Answers saved before 016 have no
  choice and keep their result. There is no admin page for answer-key corrections yet; run it from a script in a
  transaction if one is ever needed.
- **Migration and rollback.** `016_circle_sets.sql` is additive (`circle_interests`, `circle_daily_sets`,
  `circle_notices`, `site_settings`, nullable `item_responses.choice`). Code rollback: unset `CIRCLES_ENABLED` or switch
  back to the previous release (it never reads them; its record path simply stops writing `choice`). Schema rollback,
  only after the previous release is live: `DROP TABLE circle_notices; DROP TABLE circle_daily_sets; DROP TABLE
  circle_interests; DROP TABLE site_settings; ALTER TABLE item_responses DROP COLUMN choice; DELETE FROM
  schema_migrations WHERE name = '016_circle_sets.sql';` (as in the migration header).

## Pilot measurement (roadmap P.2)

`/admin/pilot/` shows the spec 4a.2 pilot metrics against their thresholds, computed from data the site already holds
(no new tracking, no cookie, aggregates only). Activation, return and interest uptake are over verified accounts created in
the last 21 days ("signed-in members"); visitors are not measured because the site holds no visitor identifiers.
Quality is unpublishes plus text edits of published items per 100 items published in the window. Pilot B (circle value) is
the owner's hand tally and is not shown. Thresholds are the `PILOT_THRESHOLDS` constant in `lib/admin/pilot.ts`; changing
the owner's numbers (P.1) is a one-line edit.
- **Log operating hours** with the form on the page (`ops.log_hours`): one row per week, saved under that week's Monday;
  logging the same week again replaces it. Effort is the average of the last 4 logged weeks, met under 2 hours.
- Migration `013_operating_hours.sql` is additive. Rollback: `DROP TABLE operating_hours` and delete its
  `schema_migrations` row.
