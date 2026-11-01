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
`node --import tsx agents/mcp/server.ts --env <staging|prod>`. They give Claude Code four tools
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

## Admin and worker (Project 1C)

**Admin sign-in.** `/admin/` is for the addresses in `ADMIN_EMAILS` (comma-separated, in the root-owned env file
`/opt/sparkkindly/shared/<env>.env`; never in the repository). Sign-in is an emailed link (15 minutes, single use, used
by pressing Continue so mail scanners cannot spend it) and then the code from an authenticator app. Sessions last at most
12 hours and end after 60 idle minutes; five wrong codes end the attempt. Every admin action and sign-in step is in
`audit_log`. Staging sets `ADMIN_LINK_BASE=https://staging.sparkkindly.com` so its links point at staging.
- **Add or remove an approver:** edit `ADMIN_EMAILS` and `sudo systemctl restart sparkkindly-web` (or `-staging`).
  Removing an address ends its sessions on the next request. This is also the recovery path if sign-in links are
  being flooded: links are capped at 3 new per address per hour, then the pending link is re-sent at most every 5 minutes,
  so a flood can delay a link but never grant access.
- **Enrol an authenticator** (once per approver, and again to replace a lost phone): through the SSH tunnel with
  `DATABASE_URL` for that environment, run `npm run admin:totp -- <email>`; it prints an `otpauth://` URI once. Add it to
  the authenticator app (paste it, or make a QR code locally), and do not save it anywhere else. Re-running replaces the
  secret and ends that address's sessions.

**Agent keys** are created, rotated (old key dead at once) and revoked in `/admin/agents/`; the new key is shown once on
a page that is not cached. Keys older than 90 days are flagged there and in the digest.

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
