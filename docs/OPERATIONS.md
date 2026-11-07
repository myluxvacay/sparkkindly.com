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

**Starter content (staging only).** `npm run content:import` seeds the worlds (six, with Save) and the curated topics and imports the
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
(play and discover 08:00, together, grow and save 13:00, kids 18:00, local time). Each run calls `claude -p "/daily-run env=<env>
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

- **Settings page.** `/account/settings/` (adult context only; behind `ACCOUNTS_ENABLED`) holds three notification preferences (`notify_daily_set`, `notify_weekly_circle`, `notify_invites`, all off by default) and the time zone (a native select of supported zones; an invalid value keeps the old one). Invite emails (4B) and the circle set-ready, re-score and weekly emails (4D) honour them. Every POST (save, export, delete, PIN reset) checks `Origin`, takes the account from the session only (form-supplied account or profile ids are ignored) and answers 403 in a child context. Anonymous goes to sign-in. A consent-pending 13 to 15 account sees the form disabled ("available after your parent or guardian confirms") and its save is refused with a neutral code: until consent it saves interests only. Export, PIN reset and the interests save each allow 30 POSTs per account per hour (in memory, per process); past that the answer is 429 "Too many attempts. Please try again later."
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
  web service: the rows stay, nothing reads them, and the closed-circle and invite purges keep running in the worker.
  Ruling (final review 6): the purges are deliberately not gated on `CIRCLES_ENABLED`; they only delete or null data,
  and gating them would keep closed circles and invited addresses past their documented retention. The circle mail job
  is gated, and the stop-invites page and POST stay on whatever the flags say (an opt-out link already emailed must
  keep working). With circles off the share prompt does no session lookup and the settings page omits the circle
  email sentence.
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
- **Lock order.** Circle writes and account deletion lock circle rows first, then the account row. The inactivity and
  consent sweeps lock the account row first and then delete it, so a sweep racing a circle write on the same account can
  deadlock; PostgreSQL aborts one transaction, which fails safe (nothing half-done) and is retried on the sweep's next
  run or by the person trying again.
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
  schema_migrations WHERE name = '014_circles.sql';` (as in the migration header). The circle schema rollbacks work only
  in reverse order, 020 back to 014 (each later table references an earlier one). An older release's account deletion
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
  slot, and a refused budget spends no address slot. **Rotating `UNSUBSCRIBE_SECRET` changes every address hash**: the
  suppression list stops matching (people who chose "never email me invites again" could be invited again) and every
  address's weekly cap restarts; it also invalidates every unsubscribe link already sent. Rotate it only if it leaked. Circle names, descriptions and "your name in this
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
- **Interests.** The owner of an open circle picks up to 10 topics and 6 worlds (`/circles/<slug>/interests/`; ids are
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
  it stops scoring. Removing the child gives later sets the full range again; the days the child was a member stay
  child-safe (no `adults` item shown or scored), recorded in `circle_child_days` by a trigger when a child member row
  is closed or deleted (migration `020_circle_child_days.sql`, 4C review). Rollback, only after the previous release is
  live: `DROP TRIGGER circle_members_child_days ON circle_members; DROP FUNCTION circle_child_days_mark(); DROP TABLE
  circle_child_days; DELETE FROM schema_migrations WHERE name = '020_circle_child_days.sql';`.
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
  set in the last 30 days (the circle page shows "Scores corrected"; 4D emails it, see "Circle email, reports and hiding"). Answers saved before 016 have no
  choice and keep their result. There is no admin page for answer-key corrections yet; run it from a script in a
  transaction if one is ever needed. **Never change `item_answers.answer` with a plain UPDATE**: every key correction
  goes through `changeAnswerKey` inside a transaction, or stored answers and circle scores silently disagree with the key.
- **Migration and rollback.** `016_circle_sets.sql` is additive (`circle_interests`, `circle_daily_sets`,
  `circle_notices`, `site_settings`, nullable `item_responses.choice`). Code rollback: unset `CIRCLES_ENABLED` or switch
  back to the previous release (it never reads them; its record path simply stops writing `choice`). Schema rollback,
  only after the previous release is live: `DROP TABLE circle_notices; DROP TABLE circle_daily_sets; DROP TABLE
  circle_interests; DROP TABLE site_settings; ALTER TABLE item_responses DROP COLUMN choice; DELETE FROM
  schema_migrations WHERE name = '016_circle_sets.sql';` (as in the migration header).

## Circle email, reports and hiding (Project 4D)

- **Flags.** Same as circles: `ACCOUNTS_ENABLED` and `CIRCLES_ENABLED`. With either unset the worker sends no circle
  mail, `/circles/<slug>/report/` is a 404 and no share prompt shows. `/admin/circles/` itself is an admin page and
  always available (it simply lists nothing until reports exist).
- **Circle mail job** (`lib/jobs/circle-mail.ts`, `lib/circles/mail.ts`). Once per UTC hour (`job_runs` key
  `circle-mail` + the hour) the worker selects: the set-ready email for each open, visible circle with at least one
  member besides the owner, from 07:00 in the circle's time zone (period: the local day; the set is made then if
  nobody opened it, and an empty set sends nothing); the weekly summary of the previous Monday-to-Sunday week from Monday
  08:00 local (period: that Monday; if the worker was down all Monday it goes later that week); and one re-score email
  per `circle_notices` row of the last 24 hours. Recipients are current account members (never a child profile) whose
  account is verified, not consent-pending, with `notify_daily_set` (set-ready, re-score) or `notify_weekly_circle`
  (weekly) on, re-read when the mail is chosen. Each (circle, kind, period) is claimed in `circle_mail_log` before
  sending, so a rerun, a crash and restart, or two workers never mail a period twice.
- **What the emails show.** The set-ready and re-score emails name only the circle and link to it: no item, answer or
  member name. The weekly email shows the recipient's own rank and points (and, for an adult, each of their own child
  profiles by circle name), the circle total and the member count; never another member's name. Every email ends with
  the 3E unsubscribe link for its preference and carries `List-Unsubscribe` (the one-click
  `/account/unsubscribe/confirm/?t=…` POST) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), sent
  as MailerSend custom headers. Without `UNSUBSCRIBE_SECRET` no circle email is sent at all.
- **Custom headers and the MailerSend plan.** MailerSend custom headers may need a paid plan. If MailerSend refuses
  them (HTTP 422), `sendEmail` sends the message once more without them and logs only "custom headers refused (status
  422)"; the body's unsubscribe link still goes out, but mail clients then show no one-click unsubscribe. Before
  `CIRCLES_ENABLED` is turned on, send one real staging circle email and inspect its raw headers for
  `List-Unsubscribe` and `List-Unsubscribe-Post`; if they are missing, upgrade the plan or accept body-link-only
  unsubscribe as an owner decision.
- **Caps and failures.** At most 200 emails and 50 (circle, kind, period) batches a run; a circle is never split, the
  rest go next hour. The run refuses (one `failed_jobs` alert) when the worker and database clocks differ by more than 10
  minutes. Each send is bounded by `sendEmail`'s 10-second timeout. A failed send is not retried in that period (the
  claim stays, as retrying would re-mail those who got it); each run with failures writes one `failed_jobs` row with
  the count, never an address.
- **How to stop mail.** All of it: unset `CIRCLES_ENABLED` (or remove `UNSUBSCRIBE_SECRET`, which also disables
  unsubscribe and invite mail). One person: they untick the preference in settings or use the email's unsubscribe link.
  One circle: hide it in `/admin/circles/`.
- **Reports.** A current account member whose account may join circles reports their own circle from the circle page
  ("Report this circle": reason `name`, `behaviour`, `safety` or `other`, optional note up to 300 characters; blocked
  words are not applied to notes). 5 reports per account per rolling day. A child profile context gets 403 (it tells its
  adult). The row (`circle_reports`) keeps the circle, the reporter account (nulled when that account is deleted, so the
  report stays), reason, note and times; never a member's contact details. Reporters see their own reports in their
  data export.
- **Hiding.** `/admin/circles/` lists reported circles (open and total report counts, the latest reason and note, member
  count; no names or addresses) with "Hide circle", "Restore circle" and "Mark reports handled" (admin actions
  `circle.hide`, `circle.restore`, `circle.reports_handled`, each audited). A hidden circle is a 404 for its members on
  every page, leaves their lists, the communities list and invite pages, and gets no mail; nothing is deleted, and
  restore brings everything back.
- **Share prompt** (`lib/circles/share-prompt.ts`). After an adult-context member answers an item that is in today's
  set of one of their circles, the result area offers "Invite someone to <circle>" (only where they may invite) and the
  item's public URL as text to copy, with nothing appended (no circle, member or account id). Never in a child context,
  never for Kids world items, never for anonymous visitors.
- **Migrations and rollback.** `018_circle_mail.sql` (`circle_mail_log`) and `019_circle_reports.sql`
  (`circle_reports`) are additive (017 was already taken by the invite address guard). Code rollback: unset
  `CIRCLES_ENABLED` or switch back to the previous release (it never reads them). Schema rollback, only after the
  previous release is live: `DROP TABLE circle_reports; DROP TABLE circle_mail_log; DELETE FROM schema_migrations WHERE
  name IN ('018_circle_mail.sql', '019_circle_reports.sql');`.

## Comments (Project 7A)

- **Flags.** Comments need `ACCOUNTS_ENABLED` **and** `COMMENTS_ENABLED` (`true` or `1`). With either unset there is no
  comment section on any page (absent from the HTML), `/comments/post|edit|delete/` and `/community/guidelines/` are
  404s and `/admin/comments/` is a 404 (no nav link). Both are off everywhere; the env examples carry a commented
  `# COMMENTS_ENABLED=`. Turning comments off is unsetting `COMMENTS_ENABLED` and restarting the web service: the rows
  stay and nothing shows them.
- **Who and where.** Signed-in, verified accounts with `public_comment` (16+; never 13-15, whatever the consent), not
  banned, in the adult context. A child profile context never sees a comment section (no section, count or text in the
  HTML) and its POSTs get 403. Anonymous visitors read published comments and are sent to sign in to post. Comments
  exist only on published, visible items. **Kids ruling (plan 7A):** Kids-world items and any `audience = 'kids'` (or
  kids-tier) item never carry comments for anyone, whatever the switches; the admin page does not offer Kids (spec 4a.5
  wins over Project 7's "owner can turn it on").
- **Switches** (`/admin/comments/`, audited admin actions). `comments.world_toggle` per world (`worlds.comments_enabled`,
  on by default, off for Kids); `comments.item_toggle` by item path (`items.comments_enabled`: on, off, or NULL to follow
  the world; the item beats the world). When off, the section disappears and posting is refused; existing comments are
  kept but not shown.
- **Shape.** Plain text, 1 to 1,000 characters after NFKC and trim (line breaks kept; other control and zero-width
  characters dropped), one level of replies (a reply's parent must be a top-level comment on the same item, published or
  the replier's own held one), display name and relative time only. The display name (1 to 30 characters, no `@`, no
  blocked word, nothing link-like) and the "I have read the community guidelines" tick are asked at the first comment and
  stored in `account_trust`; the email is never shown. Blank-looking text (Hangul fillers and other default-ignorable
  characters) counts as nothing, and reserved names (SparkKindly, Admin, Administrator, Moderator, Mod, Owner, Staff,
  Support, Team, any case or spacing) are refused. Bodies render as React text: nothing is HTML, markdown or a link.
- **Trust ladder** (`lib/comments/trust.ts`). Every account starts at level 0: its comments are `held` (published by the
  moderation agent in 7B). After `TRUST_THRESHOLD` = 5 approvals since the last drop it moves to level 1: comments are
  `published` at once after the checks. A rejection drops a level and resets the approved count. The owner sets level 0
  or 1, or bans and lifts a ban, in `/admin/comments/` by pasting a comment id or link (`…#comment-<id>`):
  `comments.trust_set`, `comments.ban`, audited against the comment, never the account or its email. A banned account
  cannot post or edit.
- **Checks on every comment**, in order, each with its own refusal: banned; rate (5 per 10 minutes and 40 per rolling
  24 hours per account, counted in the database under the account's trust-row lock, so racing posts cannot pass it);
  length; blocked words (`lib/items/blocked.ts`, also behind combining marks); duplicate (the same text, ignoring case
  and spacing, by the same account in 24 hours, or published on the same item, or the author's own on it in any status:
  another member's held or hidden text is never confirmed); link policy (below level 1 any link-like text, the shared check in
  `lib/circles/rules.ts`, is refused; at level 1 it is accepted and shown as plain text). An edit re-runs every check but
  the rate limit.
- **Edit and delete.** The author edits within 15 minutes of posting (exactly 15 allowed); a level-0 author's edit of a
  published comment goes back to `held`. Delete a held or published comment at any time (a hidden or rejected one
  cannot be deleted, so its hidden replies never reappear under a placeholder): status `deleted`, body emptied, row kept so replies keep
  their place (shown as "This comment was deleted."). Only `published` comments are ever shown to others; the author
  also sees their own `held` ones marked "Waiting for review".
- **Account deletion and export.** Deleting an account cascades its `account_trust` row and its comments, and with them
  every reply under those comments. The data export lists the holder's own comments (item, world, reply or not, body,
  status, times) and their trust row; never another's comment, ids, or the moderation reason (7B emails that).
- **Migration and rollback.** `021_comments.sql` is additive (`account_trust`, `comments`, `worlds.comments_enabled`,
  `items.comments_enabled`). Code rollback: unset `COMMENTS_ENABLED`, or switch back to the previous release (it never
  reads them). Schema rollback, only after the previous release is live: `DROP TABLE comments; DROP TABLE
  account_trust; ALTER TABLE items DROP COLUMN comments_enabled; ALTER TABLE worlds DROP COLUMN comments_enabled;
  DELETE FROM schema_migrations WHERE name = '021_comments.sql';`.
- **Caching and profile switches.** Item pages with comments are `force-dynamic` and served `private, no-store`; no
  code sets `Vary: Cookie` (nothing caches these pages, so none is needed). After switching to a child profile, the
  browser's back/forward cache can still show an adult page already open in that tab until it is reloaded; the next
  request is rendered for the child context. Close adult tabs before handing the device to a child.
- **Before production.** Privacy and terms must mention comments, the guidelines page copy needs the owner's read, and
  reporting plus the moderation agent (7B) must exist before `COMMENTS_ENABLED` goes on anywhere real
  (`docs/legal/go-live-copy-changes.md`).

## Comment moderation (Project 7B)

Behind the same flags as comments. Plan `docs/superpowers/plans/2026-11-05-project-7b-comment-moderation.md`.

- **Reports** (`/comments/report/`, a `<details>` form under other members' published comments; adult context, 16+,
  verified, not banned). Reasons `abuse`, `personal_info`, `advertising`, `off_topic`, `other`, a note up to 300
  characters, an urgent checkbox. 10 reports a rolling day per account, at most 3 of them urgent (a 4th urgent is stored
  as a normal report, without an alert). Weight: level 1 = 1, level 0 = 0.5, muted = 0, fixed when the report is made.
  Open weight >= 2 hides the comment. An urgent report from any reporter who is not muted hides the comment at once
  (7B review H1; the earlier level-1-only ruling is reversed) and alerts the owner (ADMIN_EMAILS, the digest mail path,
  counts only, saying it was hidden). A muted reporter's urgent report hides nothing, sends no email and never reaches
  the agent (zero-weight reports never change what the agent sees, and their notes are not in its `data`): it shows in
  the owner queue and the digest count only, and the owner can Publish or Remove it. At most 20 urgent alert emails are
  sent a UTC day (only emails actually sent count, one `job_runs` row each, job `urgent-alert`); the 21st sends one
  "cap reached for today" email and then nothing until the next UTC day. A report-triggered hide bumps `updated_at`, so
  an agent decision read before it is `stale`.
- **The agent's queue and decisions** (`lib/comments/moderation.ts`, `decisions.ts`). Queue order: held, then reported
  (hidden with open reports), then the sample (about 10% of newly published level-1 comments, `sampled_at`). Escalated
  comments leave the queue. Each entry has an opaque `version` (the comment's `updated_at`); a decision with an old
  version is refused (`stale`, 409): the author edited after the agent read it. Decisions: approve (held or sample:
  publishes, counts an approval), reject (held: `rejected`; reported or sample: `hidden`; trust drops, author emailed),
  hide (reported or sample), keep (reported: restored, reports dismissed; only level-0 reporters are charged a false
  report, so the agent can never demote or mute a level-1 reporter; a sampled comment is marked reviewed), escalate (left
  held or hidden, a sample is hidden; owner decides). Reject and hide need a `code` (`abuse`, `personal_info`,
  `advertising`, `off_topic`, `links`, `other`): the author's email carries only the fixed sentence for it
  (`AUTHOR_REASONS`, `lib/comments/rejection-email.ts`). The agent's free-text `reason` (no links, @, line breaks or
  control characters) and its escalation note (`comments.escalation_note`) are for the owner only and never emailed.
  A keep on a comment that a level-1 reporter's urgent report hid is converted to an owner escalation (the comment stays
  hidden, the report open; the reply says `converted: escalated`). At most 10 keeps per agent per UTC day (the 11th is
  `limit`, 409; the comment stays queued). Approve and keep are refused for a banned author or (approve) text that now
  fails the length, blocked word or link checks. A deadlock is retried once. Every decision writes an `audit_log` row (actor `agent:<name>`, action `comment.<decision>`, no
  text). A repeated decision returns the current state with no second effect.
- **Rejection email** (essential mail, to the author's address only): the first 80 characters of their comment, the
  reason, the guidelines link and a signed appeal link (30 days, bound to the comment and the author, HMAC under
  `UNSUBSCRIBE_SECRET` with its own `appeal:v1` domain; without the secret the email goes out without the link). A failed
  send is logged and does not undo the decision; there is no resend (watch the worker and web logs).
- **Appeals** (`/comments/appeal/<token>/`: the GET only reads; the button POSTs; one per comment; 20 POSTs an hour per
  address). The owner decides in `/admin/comments/`: overturn (published again, the rejection taken back from the counts;
  the level stays as it is, set it by hand if needed) or uphold; the author is emailed either way.
- **Owner queue** (`/admin/comments/`): counts, escalations with the agent's note (target within 48 hours), appeals
  (within 48 hours), urgent reports in the last 7 days (within 24 hours; those from muted reporters stay published until
  ruled on), muted reporters (by report number; reset with `comments.report_reset`). Publish or remove only an escalated
  comment or one with an open urgent report, with `comments.escalation_resolve`: Remove asks which fixed sentence the
  author is told and emails it with an appeal link; Publish dismisses the reports with owner accountability (every
  reporter whose urgent report hid it is charged a false report, at any level: three mute them and drop a level once),
  overturns an open appeal with the usual email, and clears any earlier code and reason (kept in the audit row).
  An appeal overturn clears them too. No email, account id or name is shown.
  All `comments.*` actions are refused when the comment flags are off.
- **Digest**: a Comments section with counts only (held, published, kept and rejected by the agent in 24 hours,
  escalated, open appeals, urgent reports in 24 hours) and an alert line when any escalation has waited past 48 hours.
- **Hold-everything** (spec 4a.6, `lib/comments/hold.ts`): when no enabled moderation-role agent has fetched its queue in
  the last 48 hours (`agents.queue_fetched_at`, written only by a queue fetch, never by authenticating or deciding; migration 027; exactly 48 hours still counts), new comments
  from level-1 accounts are held like level-0 ones; the author sees the normal "waiting for review" note. With no
  moderation agent at all, everything is held.
- **Weekly spot-check.** The owner's weekly spot-check of agent output (AI governance rules) includes the agent's `keep`
  decisions (the digest's kept count and the `comment.keep` audit rows): a run of wrong keeps is the sign of an injected
  or confused agent.
- **Threat notes** (there is no separate threat-model document yet; recorded here): a comment or report note may try to
  instruct the moderator, and one agent context reading many entries would let one entry steer the others. Mitigations:
  one moderator subagent per entry with only its environment's decide tool; a closed list of author-facing reasons; agent
  keeps capped at 10 a day, never charging trusted reporters, and converted to an owner escalation over a trusted
  member's urgent report; muted reporters cannot reach the agent or send email.
- **Migration and rollback.** `022_comment_moderation.sql` is additive (`comment_reports`, `comment_appeals`,
  `agents.role` defaulting to `content`, `account_trust.false_reports`/`reports_muted`, four nullable `comments`
  columns), and `024_moderation_review_fixes.sql` adds `comments.moderation_code` and `comments.escalation_note`. Code
  rollback: unset `COMMENTS_ENABLED`, or the previous release. Before switching to a release older than 7B, disable every
  moderation agent: the old code ignores `agents.role`, and a moderation agent has `world_id` NULL, which the old code
  treats as a **master content agent** that may submit items to any world. The same holds for contribution reviewer
  agents (`026_reviewer_role.sql`) and promoter agents (`028_social.sql`). Run on the server, then check it updated the
  expected rows: `UPDATE agents SET enabled = false WHERE role <> 'content';` (re-enable after rolling forward). Schema
  rollback is in the migration headers, only after the previous release is live.

### Comment moderation agent (Project 7B)

- **Key.** In `/admin/agents/` create an agent with role "Comment moderation" and world "Master agent" (a moderation agent
  is never tied to a world). Its key works only on `GET /api/agent/moderation/` and `POST /api/agent/moderation/decide/`
  (403 everywhere else; a content key gets 403 there). Put it in the owner's secrets file as
  `SPARKKINDLY_<STAGING|PROD>_MODERATION_KEY`; rotate it from `/admin/agents/` like any key.
- **Schedule.** Twice a day (the daily run and a short mid-day run, spec Project 7), a Windows Task Scheduler entry runs,
  from the repository folder: `claude -p "/moderate-run env=staging" --setting-sources project --allowedTools Agent
  mcp__sparkkindly-staging-moderation --disallowedTools Bash Write Edit Read WebFetch WebSearch`, logging to
  `%USERPROFILE%\sparkkindly-runs\` like the content run. The command reads the queue and starts one moderator per
  entry (`.claude/agents/sparkkindly-moderator-<env>.md`, each holding only its environment's decide tool, so no context
  ever sees two comments and no subagent can reach the other environment); its `allowed-tools` frontmatter limits it to
  the Agent tool and the two queue tools (frontmatter cannot depend on the `env` argument). It prints one line of
  counts and never comment text. Use `env=prod` only
  after staging has run cleanly. `register-tasks.ps1` does not create this entry yet (owner action, by hand).
- **Plan usage.** A run reads at most three pages of 20 comments and makes one call per comment; it is small next to the
  content run. Watch the first week's runs for plan-limit hits, as for the content agents.

## Contributors (Project 8)

Behind `ACCOUNTS_ENABLED` **and** `CONTRIBUTORS_ENABLED` (both off everywhere; `deploy/env/*.example` carry
`# CONTRIBUTORS_ENABLED=`). With either unset there is no `/me/contribute/`, `/contributors/...` page, byline, agent
contribution route, `contribution.*` admin action or Contributions admin page, and the worker sends no contribution
mail. Plan `docs/superpowers/plans/2026-11-05-project-8-contributors.md`.

- **Who.** Members aged 16 and over, verified, adult context, not banned from commenting (a comment ban also blocks
  contributing). The role is switched on in `/me/contribute/` by accepting `/contributors/terms/` and choosing a display
  name (comment-name checks, reserved names refused) and an optional bio. An adult may propose one link; it shows on the
  contributor page only after the owner approves it (`contribution.link_approve`), and never for a 16 or 17-year-old.
- **What.** Articles (2 to 6 headed sections, 8,000 characters of text, a takeaway) and multiple-choice quiz questions
  (four options, one correct, an explanation) in any enabled world except Kids; audience always `all`; plain text only,
  no uploads. Limits: 5 drafts, 3 pending, 10 saves an hour, 5 submissions a day per account (in memory, per process).
- **Pipeline.** Submit runs the agent item gates synchronously (schema, duplicates, blocked words and topics, sources
  resolve); a failure keeps the draft with the reasons. A pass creates the item as a `draft` and the contribution waits
  in `agent_review`. Once an item exists its kind and world are fixed and every revision is gated against the item's own
  world. The reviewer's pass moves it to `needs_owner` (item `in_review`); its fail to `changes_requested` (reasons
  shown and emailed). The owner decides in `/admin/contributions/`: approve (the same scheduling path as `item.approve`,
  bound to the version the owner reviewed; contributed items are not listed in the main queue and `item.approve`
  refuses them), request changes (notes, emailed; item back to
  draft) or reject (reason, emailed; item rejected). `item.reject` refuses a contributed item so a reason is always given.
  The approved item publishes through publish-due; the worker then sends one publication email per item with the share
  link (claimed in `contributions.publication_mailed_at` before sending; a failed send is not retried).
- **Reviewer run.** `/review-contributions env=<staging|prod>` (reviewer key, MCP servers
  `sparkkindly-<env>-reviewer` with only `sparkkindly_contributions_queue` and `sparkkindly_contribution_verdict`; the
  content, world and moderation keys get 403 there, and the reviewer key gets 403 on every other route). Create the key
  in `/admin/agents/` with role "Contribution reviewer" and world "Master agent"; put it in the owner's secrets file as
  `SPARKKINDLY_<STAGING|PROD>_REVIEWER_KEY`. Before rolling back past `026_reviewer_role.sql`, disable reviewer agents
  (see the Comment moderation rollback note).
  The command holds only the queue tools and starts one `sparkkindly-contribution-reviewer-<env>` per entry (web tools
  and that environment's verdict tool only), which reviews it with the plagiarism search and posts its verdict; a pass
  without a source opened (Sourced tier) or without the plagiarism search counts as a fail. Schedule it by hand in Windows Task Scheduler after the daily run, like
  `/moderate-run`: `claude -p "/review-contributions env=staging" --setting-sources project --allowedTools Agent
  mcp__sparkkindly-staging-reviewer WebFetch WebSearch --disallowedTools Bash Write Edit Read` (the web tools are for the
  reviewer subagents). Response target for the owner: 7 days.
- **Withdrawal and deletion.** A contributor withdraws any piece from `/me/contribute/` (confirm step); a published or
  scheduled item is archived at once, an unpublished one too. Account deletion archives published contributed items,
  deletes never-published ones, then cascades the profile and contributions, so no byline or contributor page remains.
  The export lists the profile, every contribution with its states, reasons and owner notes.
- **Migration and rollback.** `023_contributors.sql` is additive (`contributor_profiles`, `contributions`). Code
  rollback: unset `CONTRIBUTORS_ENABLED` (bylines and pages disappear; rows stay), or the previous release (it never reads
  them). Schema rollback is in the migration header, only after the previous release is live; archive any published
  contributed items first if the tables are dropped, since the old release would show them without a byline.
  The review-fix migrations `026_reviewer_role.sql` and `027_queue_fetched_at.sql` are additive too. Rolling the code back
  past them: disable reviewer agents first (see the moderation rollback note); the older code approves contributed items
  from the main queue again without the version check, mails a publication notice even for a contribution withdrawn
  mid-batch, and refreshes the hold-everything heartbeat on any moderation-key call (`last_run_at`). Roll forward as soon
  as possible; their schema rollback is in each migration header.

## Sponsorship (Project 6)

Behind `SPONSORSHIP_ENABLED` alone (off everywhere; `deploy/env/*.example` carry `# SPONSORSHIP_ENABLED=`). It does not
need `ACCOUNTS_ENABLED`; with accounts on, the account cookie adds the under-18 and child-profile checks. With it unset
there is no sponsor line, `/go/<id>/` route, `/sponsorship/` page, `sponsor*` admin action or Sponsors admin page, and
no sponsor row is read. Plan `docs/superpowers/plans/2026-11-05-project-6-sponsorship.md`.

- **Who sees it.** Only on a published item with audience `adults`, outside the Kids world and the kids risk tier; only
  for an anonymous visitor or a signed-in adult in the adult context. Never a child profile, a 13-17 account (pending or
  confirmed) or a session whose lookup failed. Nothing in circles, emails, JSON-LD, search, the sitemap or share prompts.
- **Attach.** `/admin/sponsors/`: add a sponsor (name, https link to a public host, a category from the allowed list,
  and the box "not in an excluded category and not marketed to children", recorded as `confirmed_at` and in the audit
  row). Then attach a sponsorship to one topic (its address), one world (not Kids) or one item (`world/slug`, a published
  adults item), with link text (up to 60 characters), the kind (`supported` or `affiliate`, which picks the fixed
  disclosure sentence) and optional first and last days (UTC dates, inclusive; a sponsorship ending today shows until
  the end of today UTC). Precedence when several match: item, then topic, then world, then the most recently started.
- **End.** "End now" on the sponsorship (`sponsorship.end`, audited): the line disappears on the next page view and
  `/go/<id>/` sends visitors home.
- **Clicks.** `/go/<id>/` re-checks the viewer and the sponsorship, adds 1 to `click_count` in one UPDATE and redirects
  302 to the stored link with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and no cookie; anyone else goes
  to `/`. 60 clicks per network per hour (in memory, per process). Nothing about the visitor is stored, so the count is an
  upper bound (repeat clicks and bots count). Clicks cannot be edited from `/admin`. The stored link is re-checked before
  counting (a refused link counts nothing) and is kept in its ASCII form (punycode host, percent-encoded path; a link
  with a control character is refused at entry). `HEAD /go/<id>/` sends everyone home without counting, and the
  released `robots.txt` disallows `/go/`. `029_sponsor_confirmed_category.sql` adds a CHECK that a confirmed sponsor
  has a category (rollback in its header).
- **Migration and rollback.** `025_sponsorship.sql` is additive (`sponsors.category`, `sponsors.confirmed_at`, a default
  on `sponsors.disclosure`, `sponsorships.kind`, `sponsorships.ended_at`). Code rollback: unset `SPONSORSHIP_ENABLED`
  (every line disappears; rows stay), or the previous release (it never reads sponsorship). Schema rollback is in the
  migration header, only after the previous release is live.

## Social distribution (Project 5A)

Behind `SOCIAL_ENABLED` (off everywhere; `deploy/env/*.example` carry `# SOCIAL_ENABLED=` and empty `META_*` lines)
**and** a per-platform switch in `/admin/social/` (all off). With the flag unset there is no social job, promotion
route, `social.*` admin action, Social admin page, share-image format or visit counting, and every page is unchanged.
Plan `docs/superpowers/plans/2026-11-05-project-5a-social-text-image.md`. Part A posts to Instagram and Facebook only;
TikTok and YouTube take video only, through the video jobs queue (see Video jobs, below).

- **Owner prerequisites (roadmap 5.1).** A Meta Business account; a Facebook Page; an Instagram professional account
  linked to that Page; a Meta developer app with App Review for `pages_manage_posts`, `pages_read_engagement`,
  `instagram_basic`, `instagram_content_publish` and `instagram_manage_insights`. Then a long-lived **Page** access token
  (made from a long-lived user token for an admin of the Page; it does not expire while the app keeps access, and it
  stops working if the password changes or the app loses permission). Put it only in the root-owned env file on the VM,
  never in the repository, the database, a prompt, a chat or the owner's secrets file. Rotate it by replacing the line
  and restarting nothing (the worker reads the env file on each tick).
- **Env variables** (`/opt/sparkkindly/shared/<env>.env`): `SOCIAL_ENABLED=true`, `META_PAGE_ACCESS_TOKEN`,
  `META_PAGE_ID`, `META_IG_USER_ID` (the Instagram professional account id). While any one is missing the posts for that
  platform stay `scheduled` and `/admin/social/` shows "No credentials"; nothing crashes and the other platform still
  posts. Errors are stored and alerted as an HTTP status and Graph code only, never a token, caption or response text.
- **Daily flow.** The first worker tick of each UTC day picks, per switched-on platform, up to the day's cap from items
  published in the last 3 days (never Kids by world, audience or risk tier; quizzes and games first; the world with the
  oldest last post first; then topics with more answers in 14 days; then newest) and records every other candidate as
  `skipped` with its reason. The owner may hand-pick any eligible item for today in `/admin/social/` (the cap holds).
  `/promote-run env=<staging|prod>` writes the copy: one `sparkkindly-promoter-<env>` subagent per entry
  (`.claude/agents/sparkkindly-promoter-<env>.md`, holding only its environment's copy tool), through the promoter key.
  The site validates every caption (no links, domains in any script, `@`, `#` in the caption, hidden characters,
  blocked words; at most 8 hashtags; Facebook 500 characters, Instagram 2,200 in all), builds the link
  (`https://<site>/<world>/<slug>/?utm_source=<platform>&utm_medium=social&utm_campaign=<world>-<slug>`, from
  `ADMIN_LINK_BASE`) and the image URL (`/api/template-image/<world>/<slug>/?format=social`, a 1080x1350 JPEG), and
  schedules it at the platform's time (if that has passed, at once; never after 20:00 UTC, else the next day). The
  worker posts every 5 minutes, one claimed row at a time, re-checking the item and the day's cap just before the call.
- **Promoter key and schedule.** In `/admin/agents/` (visible with the flag on) create an agent with role "Social
  promotion" and world "Master agent"; its key works only on `GET /api/agent/promotions/` and
  `POST /api/agent/promotions/copy/` (403 everywhere else; every other key gets 403 there). Put it in the owner's
  secrets file as `SPARKKINDLY_<STAGING|PROD>_PROMOTER_KEY`. Schedule after the daily run, by hand in Windows Task
  Scheduler like `/moderate-run`: `claude -p "/promote-run env=staging" --setting-sources project --allowedTools Agent
  mcp__sparkkindly-staging-promoter --disallowedTools Bash Write Edit Read WebFetch WebSearch`. It prints one line of
  counts, never captions or item text.
- **Staging dry run (before production).** On staging with a test Page and test Instagram account only: set the flag
  and the test Page's credentials, switch Instagram and Facebook on with cap 1, hand-pick one item, run
  `/promote-run env=staging`, then check: `curl -s -o /tmp/s.jpg -w '%{content_type}\n'
  'https://staging.sparkkindly.com/api/template-image/<world>/<slug>/?format=social'` prints `image/jpeg` (with the
  staging basic auth; note Meta cannot fetch an image behind basic auth, so the dry run needs that one path reachable,
  or a production-like host), `file /tmp/s.jpg` says JPEG 1080x1350, the next 5-minute tick posts it, the row shows
  `posted` with a working post link, and the link opens the item with the UTM values. Record the result here.
- **Weekly caption spot-check.** Every week read the captions of the last 7 days' posted rows (`/admin/social/`, or
  `SELECT platform, caption, hashtags FROM distributions WHERE posted_at > now() - interval '7 days'`) for tone,
  accuracy and anything that should have been refused; record the date, count read and findings here (evaluation
  evidence, ai-governance.md). A bad caption: delete the post on the platform, then tighten the prompt or the checks.
- **Failures.** Transient errors (429, 5xx, network, image still processing) retry 3 times 5 minutes apart, then
  `failed`. Other 4xx and an expired token fail at once. Each failed or flagged row writes one `failed_jobs` alert (the
  digest). "Retry" in `/admin/social/` gives a failed row one more attempt now; "Cancel" stops a pending or failed one.
- **Flagged rows** need the owner: (a) the final publishing call failed in a way Meta may still have acted on, or (b) a
  row stayed in `posting` for 30 minutes (the worker stopped mid-post), or (c) the item was unpublished after posting.
  Look on the platform. For (a) and (b): if the post exists, press "Keep as posted" (the row becomes posted, is never
  retried, and its metrics are collected); if it does not, "Cancel" the row, and hand-pick the item again if it should
  still go out (a row that was ever posted cannot be hand-picked again). For (c) delete the post on the platform by
  hand, then "Cancel" the row. Archiving an item cancels its pending posts in the same transaction and flags rows that
  are posted or being posted at that moment.
- **Stale rows.** Each day's selection cancels earlier days' text rows still waiting for copy (`expired`), and the
  promotion queue offers only today's and yesterday's rows. A scheduled text post more than 24 hours past its time
  (for example while credentials were missing) is cancelled as `late` instead of being posted.
- **Visits** are counted only for items that were posted on that platform; the share image is rendered once per item
  version (in-process cache) and at most 20 renders a minute per network.
- **Metrics.** Once a day the worker reads reach, likes and comments for posts of the last 7 days; a failure is logged
  and never blocks posting. Visits from social links are counted in `social_visits` (day, platform, item, count; nothing
  about the visitor) and shown in `/admin/social/` for 30 days.
- **Dependency.** The JPEG conversion uses `sharp` 0.35.5 (Apache-2.0), already in the tree for the brand scripts and
  Next's image optimiser, moved from devDependencies to dependencies; `npm audit --omit=dev` reported 0 vulnerabilities
  (5 Nov 2026). `sharp` is a native dependency installed for the release runner's platform (Linux x86-64, glibc); the VM
  must match it, or the `?format=social` branch of `/api/template-image/` fails.
- **Pre-deploy check for `029_sponsor_confirmed_category.sql`.** Before deploying the release that carries 029, run on
  the target database `SELECT count(*) FROM sponsors WHERE confirmed_at IS NOT NULL AND category IS NULL;` It must print
  `0`; otherwise the migration fails and the deploy stops. Fix those rows first (give each a category in `/admin/sponsors/`
  or clear its confirmation) and run the check again.
- **Meta authorisation header.** The adapter sends the Page token as `Authorization: Bearer <token>`. The staging dry run
  must confirm Meta accepts it (a post goes through); if Meta refuses it, the alternative is `Authorization: OAuth
  <token>`, a one-line change in `lib/social/adapters/meta.ts` with its test.
- **Migration and rollback.** `028_social.sql` is additive (`social_platforms` seeded with caps 2/3/1/1, all off;
  `distributions`; `social_visits`; `promoter` in the agents role CHECK). Code rollback: unset `SOCIAL_ENABLED` (nothing
  posts; rows stay), or the previous release. A release from 7B on refuses the new keys; earlier releases treat any
  `world_id` NULL key as a master content agent, so disable them first (`UPDATE agents SET enabled = false WHERE role <>
  'content';`, as under comment moderation above). Its schema rollback is in the migration header.

## Video jobs (Project 5B)

Behind `SOCIAL_ENABLED` and the TikTok/YouTube switches in `/admin/social/` (off). Plan
`docs/superpowers/plans/2026-11-05-project-5b-video-queue.md`.

- **Folders (VM, once, before switching TikTok or YouTube on).** `deploy/provision/01-base.sh` creates, for each
  service user, its own media folders and token directory, mode 0700 (staging and production never share a refresh
  token or a file): production `/opt/sparkkindly/shared/media/social/{quarantine,approved}` and
  `/opt/sparkkindly/shared/social-tokens/` (owner `sparkkindly`); staging `/opt/sparkkindly/shared/media/social-staging/...`
  and `/opt/sparkkindly/shared/social-tokens-staging/` (owner `sparkkindly-staging`). Each env file names its own
  `SOCIAL_MEDIA_DIR` and `SOCIAL_TOKEN_FILE` (`deploy/env/*.example`). Check, per environment: `sudo -u sparkkindly test
  -w /opt/sparkkindly/shared/social-tokens && echo ok` prints `ok`, and `stat -c '%a %U'` on each folder prints
  `700 sparkkindly` (or `700 sparkkindly-staging`). The app refuses a media folder that is a symlink, and a token
  directory it cannot write shows "token store unavailable" in `/admin/social/` and posts nothing there.
- **Disk.** Uploads are at most 128 MB each (`SOCIAL_MAX_VIDEO_MB`, at most 256), the quarantine folder holds at most
  2 GB in all ("The upload area is full"), and an upload is refused while free space is under twice its size plus 1 GB.
  The video tick deletes quarantine files older than 7 days, files of jobs cancelled more than 30 days ago and approved
  files 14 days after posting (`video purge` in its log). Check `du -sh /opt/sparkkindly/shared/media` monthly.
- **Video poster unit.** Uploads run in their own oneshot service, `sparkkindly-video-poster.service` (staging:
  `sparkkindly-video-poster-staging.service`), every 5 minutes by its timer, with a 30 minute start timeout and 512 MB
  (`deploy/systemd/`), never in the one-minute worker. `deploy/provision/03-services.sh` installs the units; once the
  live release contains `video-worker.mjs` the owner enables each with `sudo systemctl enable --now
  sparkkindly-video-poster.timer` (and the `-staging` one), and checks `journalctl -u sparkkindly-video-poster -n 20`
  shows `video tick:` lines. Not done from here.
- **Caddy request body.** The upload is one POST of the raw file to `/admin/social/videos/<id>/upload/`. Caddy has no
  body limit by default; when installing the site block add, inside it, a limit for that path only, and leave
  `response_header_timeout` long enough for a slow upload to finish (the app answers only after the file is checked):
  `@videoUpload path_regexp ^/admin/social/videos/[0-9]+/upload/$` then
  `request_body @videoUpload { max_size 260MB }` (optionally a smaller `request_body` limit for everything else), and raise
  `response_header_timeout` to `300s`. Validate with `caddy validate` on the VM before reloading; not applied yet.
- **Flow.** The first video tick of each UTC day picks, per switched-on video platform, up to its cap of published
  `video_script` items from the last 3 days (never Kids by world, audience or risk tier; the 5A rotation and skip
  reasons) and opens one job per item and platform. `/promote-run env=<env>` gives each job to one promoter subagent,
  which sends the brief (narration, 3 to 12 shots, on-screen text, the platform's caption fields, hashtags, 15 to 60
  seconds) with `sparkkindly_promotion_brief`; the site checks every text like a caption and adds the brand assets
  itself. The job then shows in `/admin/social/videos/` as "brief ready".
- **Makers (roadmap 5.8, the owner's decision, recorded outside code).** Whoever makes the video (the owner, a family
  member, a hired editor, or a tool such as Canva) works from the brief on the job page and gives the owner the finished
  file; only the owner (an admin session with its second factor) uploads it. Record who made it in "Made by".
- **Upload and approval.** On the job page choose the finished MP4 (H.264, up to the limit shown) and upload it (the page needs
  JavaScript for this one form). The server checks it by content (the MP4 boxes must fill the file exactly, H.264, with
  ffprobe on the VM: codec, at most 3 minutes; without ffprobe a warning says only the container was checked;
  `sudo apt-get install ffmpeg` provides it) and shows the result and SHA-256. A refused file is deleted; upload again.
  **All video needs captions**: for YouTube upload a WebVTT or SRT file (up to 200 KB); for TikTok burn the captions into
  the video and tick the declaration. Every caption cue is checked like a caption (no links, mentions or blocked words)
  and the job page shows the caption file's SHA-256 and first 20 cues. "Approve for posting" approves exactly the
  video and caption checksums shown: if either was replaced after the page was opened the approval is refused ("This
  changed after you opened the page"). Approval moves the files to `approved/`, re-hashes them, and schedules the post
  at the platform's time; at post time both are hashed again and a missing or changed file stops the post (flagged).
- **Credentials and token file.** TikTok: a developer app with the Content Posting API (direct post) approved; put
  `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` and a first `TIKTOK_REFRESH_TOKEN` (from the owner's one-time OAuth
  sign-in with the `video.publish` scope) in the root-owned env file. YouTube: a Google Cloud project with the YouTube
  Data API, an OAuth client, and `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and a `YOUTUBE_REFRESH_TOKEN` (scopes
  `youtube.upload` and `youtube.force-ssl` for captions). Each environment has its own app credentials and refresh
  tokens. The video tick keeps the rotating tokens in `tokens.json` inside that environment's token directory (created
  by the app on the first refresh, mode 0600, with a lock file beside it). Never copy it into the repository, a
  prompt, a chat or the export.
- **Re-authorisation.** When a platform refuses the refresh token, or the token file is unreadable, `/admin/social/`
  shows "<platform> needs re-authorisation" and nothing posts there. Fix: sign in again to get a new refresh token, put
  it in the env file, then remove that platform's entry from the token file (as the service user, keeping mode 0600:
  `sudo -u sparkkindly node -e "const f='/opt/sparkkindly/shared/social-tokens/tokens.json',fs=require('fs');const s=JSON.parse(fs.readFileSync(f));delete s.tiktok;fs.writeFileSync(f,JSON.stringify(s),{mode:0o600})"`;
  replace `tiktok` with `youtube`, and the user and path for staging, as needed). A corrupt file is never overwritten by
  the app: replace it with `{}`.
- **Private until approved.** TikTok posts from an unaudited app are private (SELF_ONLY); after TikTok approves the app
  set `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`. YouTube uploads are private until `YOUTUBE_PRIVACY=public` (or `unlisted`);
  review the first posts before changing either. YouTube's default quota allows about 6 uploads a day: ask Google for a
  quota increase before raising the cap. A quota or rate limit makes posts wait (6 hours for a quota, 30 minutes for a
  rate limit) and writes one digest line per platform per day.
- **Flagged video rows** need the owner, as in 5A: the last upload call (or, for TikTok, any status check after the
  upload) failed in a way the platform may have acted on, a row stopped mid-upload (after 45 minutes), an approved file
  changed on disk (nothing was sent), YouTube took the video but not
  the captions (add them in YouTube Studio), or the item was unpublished after posting (delete the post by hand).
  Check the platform; then cancel the job (if the video is not there) or press "Keep as posted" on its row in
  `/admin/social/` (it is there). A flagged TikTok row that carries its publish id is checked again by every video
  tick: TikTok's "complete" settles it as posted and "failed" as failed (nothing was posted, so Retry is safe). A failed
  row has "Retry".
  Archiving an item cancels its unposted jobs; their files go after 30 days.
- **Migration and rollback.** `030_video_jobs.sql` (one table) and `031_video_captions_checksum.sql` (three columns)
  are additive. Code rollback: switch TikTok and YouTube
  off in `/admin/social/` or unset `SOCIAL_ENABLED`; or deploy the previous release (it never reads `video_jobs`).
  Schema rollback is in the migration header; remove the media folder and token file by hand afterwards.

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

## SEO

- **Static asset caching (SEO audit M5).** `deploy/caddy/sparkkindly-public-app.caddy` and
  `deploy/caddy/sparkkindly-staging.caddy` send `Cache-Control "public, max-age=604800"` (deferred, replacing the app's
  header) for `/images/*` and `/brand/*`. The production snippet's pinned checksum in `deploy/cutover/switch-to-app.sh`
  was updated with it. The live Caddy config is not changed by a deploy: after the change is merged, the owner installs
  the updated snippet on the VM (for production through the cut-over script, for staging through
  `deploy/provision/04-caddy-staging.sh`) and reloads Caddy (`sudo systemctl reload caddy`, after `caddy validate`).
- **Sitemap.** One file at `/sitemap.xml` with up to 45,000 items (under the 50,000-URL limit; tested at the cap). When
  the published item count nears that, split it into `generateSitemaps()` chunks with an index.
- **Deferred minors (SEO audit, 6 Nov 2026).** L7 favicon set (an `.ico` and SVG icon beside the PNGs), L8 hero
  image alt text review, L9 a micro-cache for anonymous public pages, L10 client JavaScript size. Not done; revisit
  after launch traffic shows whether they matter.
- **Owner decisions pending (SEO audit).** (1) AI-crawler policy in `app/robots.ts`: allow or disallow GPTBot, ClaudeBot
  and Google-Extended (today all crawlers get the same rules). (2) A `/.well-known/security.txt` with a contact the owner
  reads. (3) An HSTS header (`Strict-Transport-Security`) in the production Caddy block; once sent, browsers refuse
  plain HTTP for its max-age, so start with a short max-age and no `preload`.

## Sharing

- Every published item page, and the quiz of the day, has a "Share this" section under the content
  (`components/item/ShareButtons.tsx`, links built in `lib/public/share.ts`). Plain links work without JavaScript:
  WhatsApp, text message, email, Facebook, X, Telegram. A small client island (`components/item/ShareClient.tsx`) adds
  the device "Share…" button where the browser supports it and "Copy link" with a "Link copied" confirmation; it uses no
  storage and makes no requests. Nothing loads from a share site until a link is clicked.
- The shared link is the clean canonical item URL (no query string, so no tracking, session or answer); the text is the
  title, with "Can you get this one?" before it for quizzes and games, never an answer or result.
- Kids items (world or audience `kids`) show no social-network links; a child context (a child profile, or a scope
  without adults) shows only the device share and copy buttons. Circle pages have no share section; the circle's own
  "Play it together" prompt is unchanged.
