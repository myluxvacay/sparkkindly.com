# Project 0: Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A push to `main` deploys SparkKindly to the VM as a systemd service with automatic rollback, a password-protected staging site deploys from `staging`, nightly encrypted backups land in Backblaze B2 and have been restored once, and an outage or a missed backup emails the owner — all without changing the live mock-up.

**Architecture:** The existing Next.js app is switched from static export to a standalone Node server with a `/api/health` endpoint, and deployed as a tarball over SSH into timestamped release directories under `/opt/sparkkindly/releases` with a `current` symlink. A forced-command SSH key lets GitHub Actions deliver releases but nothing else. PostgreSQL 16 from Ubuntu packages, `age` + `rclone` for backups, systemd timers for backup, restore-test and disk checks, Better Stack for uptime and heartbeat alerts, MailerSend for email. Caddy is touched only by adding one import line for staging; sparkkindly.com keeps serving the mock-up until Project 1.

**Tech Stack:** Next.js 16.4.2 (standalone output), Node 24.22.0 (private install under `/opt/sparkkindly/node`), PostgreSQL 16, systemd, Caddy 2.11, Bash, GitHub Actions, `age`, `rclone`, Backblaze B2, Better Stack, MailerSend, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` — Project 0, section 4a.6 (operating model), section 7 (technical acceptance criteria).

## Global Constraints

- Node **24.22.0** everywhere (`.nvmrc`, `engines`, the VM install). No Docker.
- PostgreSQL 16 from Ubuntu's packages, listening on **127.0.0.1 only**; **separate roles with separate passwords** `sparkkindly` (owns database `sparkkindly`) and `sparkkindly_staging` (owns `sparkkindly_staging`); `CONNECT` revoked from `PUBLIC` on both, so neither environment can open the other's database.
- **Separate OS users:** `sparkkindly` runs and deploys production, `sparkkindly-staging` runs and deploys staging, under systemd with `MemoryMax=1G` (prod web) and `MemoryMax=512M` (staging web). Ports: prod **3100**, staging **3101**, loopback only.
- Ownership rule: `/opt/sparkkindly` (with `bin/`, `node/`, `home/`, `shared/`) is **root-owned**; a service user may write only its own release directory (`/opt/sparkkindly/app` for prod, `/opt/sparkkindly-staging` for staging). The deploy script, the forced-command keys and the env files are therefore beyond the reach of the web processes.
- Releases live in `<root>/releases/<UTC timestamp>-<short sha>` where `<root>` is `/opt/sparkkindly/app` (prod) or `/opt/sparkkindly-staging`; `<root>/current` is the live symlink; keep the **last 5**. Rollback = switch symlink + restart.
- Secrets live only in GitHub Actions secrets and in `/opt/sparkkindly/shared/*.env` (mode 640, `root:<that environment's user>`: `prod.env` → `sparkkindly`, `staging.env` → `sparkkindly-staging`). Never in the repository.
- **MyLuxVacation is not touched.** `/etc/caddy/Caddyfile` is edited only by adding `import` lines, and `/opt/myluxvacation/deploy/Caddyfile` gets the same line (the existing `activate-public.py` enforces that both files match). `ufw` stays at 22/80/443.
- **The mock-up stays live** for all of Project 0: Caddy's `sparkkindly.com` block is not changed.
- Staging is `staging.sparkkindly.com`, basic-auth protected at Caddy, and runs with `SITE_RELEASE=false` (noindex, empty sitemap).
- Backups: nightly at 03:15 UTC, `pg_dump -Fc`, encrypted with `age`, copied to B2 bucket `sparkkindly-backups`, 30-day retention, minimum size check, heartbeat ping on success only.
- Alerts go to the owner's email through Better Stack. The browser must make **no third-party requests** (existing e2e test enforces this), so no client-side monitoring SDKs.
- Email from `hello@sparkkindly.com` through MailerSend; token only in env.
- Commit after each task, following `.claude/rules/git.md`: inspect status and diffs first, no secrets, no builds,
  no AI co-author trailers. Commits and pushes happen only with the owner's authorization for this plan.

## Methodology

This plan is executed under `AGENTS.md`. Tier per task: Tasks 1, 2 and 12 are **Standard** (application code and
documentation inside established boundaries; one consolidated review, self-review named as such for the smaller
ones). Tasks 3 to 11 are **High-risk**: server provisioning, the deploy pipeline and its key, secrets handling,
backups of real data, and new external integrations (Backblaze B2, Better Stack, MailerSend). They get the
adversarial checks written into their steps (Review Focus 1–5) and an independent review before the branch is
merged; the reviewer independently re-runs the rollback drill (Task 5 Step 6) and the failed-backup test (Task 8
Step 4). Each task ends with the AGENTS.md completion report: tier; changed outcome; checks and results; review
performed; remaining risks/gates. The owner prerequisites are owner decisions, not builder tasks.

## Review Focus

1. **A broken release must never become the rollback target.** `previous` is recorded only after a release passes its health check (Task 5 test: a failing release leaves `previous` and `current` unchanged).
2. **A half-extracted release must never go live.** The symlink switches only after `tar` exits 0 and the release directory contains `server.js` (Task 5 test: garbage on stdin → non-zero exit, `current` unchanged).
3. **An empty or truncated backup must not count as a backup.** `set -o pipefail`, a minimum size of 10 KB, and no heartbeat ping on failure (Task 8 test: a non-existent database → no file uploaded, exit 1, no ping).
4. **A deploy with a missing required environment variable must fail health, not pass silently.** `/api/health` returns 503 and lists missing variables (Task 1 test).
5. **Staging must never be reachable without a password or indexable.** Caddy `basic_auth` on the whole site; `SITE_RELEASE=false` (Task 7 tests: 401 without credentials; `robots.txt` contains `Disallow: /` with credentials).

## Owner prerequisites (collect before Task 6; nothing in Tasks 1–5 needs them)

- [ ] Backblaze B2 account; bucket `sparkkindly-backups` (private); an application key scoped to that bucket. Give the builder the key ID and key.
- [ ] Better Stack account (free tier): one uptime monitor for `https://staging.sparkkindly.com/api/health` (with the basic-auth credentials from Task 7) and three heartbeats named `sparkkindly-backup` (period 1 day, grace 2 h), `sparkkindly-restore-test` (period 31 days, grace 2 days), `sparkkindly-disk` (period 1 day, grace 2 h). Alert channel: owner email. Give the builder the three heartbeat URLs.
- [ ] MailerSend account; add domain `sparkkindly.com`; give the builder the DNS records MailerSend shows (SPF, DKIM, return-path) and an API token with "Email send" permission. Create inbox `hello@sparkkindly.com` at the owner's mail provider (MailerSend sends; it does not host the inbox).
- [ ] DNS access for `sparkkindly.com`: an `A` record `staging` → `2.25.121.2`, the MailerSend records, and a DMARC `TXT` at `_dmarc` with `v=DMARC1; p=quarantine; rua=mailto:hello@sparkkindly.com`.
- [ ] A 15-minute window in which the VM may reboot once (kernel update), with MyLuxVacation briefly unavailable.

---

### Task 1: Switch the app to a standalone server with a health endpoint

**Files:**
- Modify: `next.config.ts`
- Modify: `package.json` (scripts `preview`, `start`)
- Create: `lib/env.ts`
- Create: `lib/health.ts`
- Create: `app/api/health/route.ts`
- Test: `tests/unit/health.test.ts`
- Modify (only if the e2e 404 check fails under `next start`): `tests/e2e/site.spec.ts` line with `/404.html`

**Interfaces:**
- Produces: `requiredEnv: readonly string[]` and `missingEnv(env: NodeJS.ProcessEnv): string[]` in `lib/env.ts`. `requiredEnv` is `['DATABASE_URL','MAILERSEND_API_TOKEN','MAIL_FROM','SITE_RELEASE']`.
- Produces: `getHealth(deps: {env: NodeJS.ProcessEnv; checkDb: () => Promise<void>; release: string}): Promise<{ok: boolean; release: string; db: 'ok' | 'error'; missingEnv: string[]}>` in `lib/health.ts`. `ok` is true only when `db === 'ok'` and `missingEnv` is empty.
- Produces: `GET /api/health` → JSON from `getHealth`, status 200 when `ok`, 503 otherwise. `release` comes from the file `RELEASE` in the working directory (written by the deploy), falling back to `'dev'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/health.test.ts
import {describe,it,expect} from 'vitest';
import {getHealth} from '@/lib/health';
import {missingEnv} from '@/lib/env';
const fullEnv={DATABASE_URL:'postgres://x',MAILERSEND_API_TOKEN:'t',MAIL_FROM:'hello@sparkkindly.com',SITE_RELEASE:'true'};
describe('health',()=>{
 it('is ok when db responds and env is complete',async()=>{
  const h=await getHealth({env:fullEnv,checkDb:async()=>{},release:'abc1234'});
  expect(h).toEqual({ok:true,release:'abc1234',db:'ok',missingEnv:[]});
 });
 it('fails when db throws',async()=>{
  const h=await getHealth({env:fullEnv,checkDb:async()=>{throw new Error('down');},release:'abc1234'});
  expect(h.ok).toBe(false);expect(h.db).toBe('error');
 });
 it('fails and names missing env vars',async()=>{
  const {MAIL_FROM,...env}=fullEnv;
  const h=await getHealth({env,checkDb:async()=>{},release:'abc1234'});
  expect(h.ok).toBe(false);expect(h.missingEnv).toEqual(['MAIL_FROM']);
 });
 it('missingEnv lists every absent required variable in order',()=>{
  expect(missingEnv({})).toEqual(['DATABASE_URL','MAILERSEND_API_TOKEN','MAIL_FROM','SITE_RELEASE']);
 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/health.test.ts`
Expected: FAIL — cannot resolve `@/lib/health` and `@/lib/env`.

- [ ] **Step 3: Implement `lib/env.ts` and `lib/health.ts`**

`lib/env.ts`: export `requiredEnv` and `missingEnv(env)` (filter `requiredEnv` by `!env[name]`). `lib/health.ts`: `getHealth` awaits `checkDb()` in a try/catch to set `db`, computes `missingEnv(env)`, returns the object. No I/O other than `checkDb`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/health.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the route and the server build**

`app/api/health/route.ts`: `export const dynamic='force-dynamic'`; `GET` builds `checkDb` from `pg` (`new Pool({connectionString:process.env.DATABASE_URL,max:1})`, `query('SELECT 1')`, `end()`), reads `RELEASE` with `fs.readFileSync(path.join(process.cwd(),'RELEASE'),'utf8').trim()` in a try/catch defaulting to `'dev'`, returns `Response.json(health,{status:health.ok?200:503})`. Install `pg` and `@types/pg` as dependencies (pinned exact versions, matching the repo's convention).

`next.config.ts`: replace `output: 'export'` with `output: 'standalone'`; keep `trailingSlash: true`, `images: {unoptimized: true}`, `poweredByHeader: false`.

`package.json`: `"start": "next start"`, `"preview": "next start -p 4173"` (replaces `serve out`). Remove `serve` from devDependencies.

- [ ] **Step 6: Build and run the server locally**

Run: `npm run build` then, in another shell, `npm run preview`, then `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/api/health`
Expected: build succeeds and prints `.next/standalone`; health returns **503** (no `DATABASE_URL` locally) with a JSON body listing the four missing variables. `curl -s http://localhost:4173/discover/a-day-in-shadows/ | grep -c 'A day in shadows'` prints `1`.

- [ ] **Step 7: Run the full check set**

Run: `npm run lint && npm run typecheck && npm test -- --run`
Expected: all pass. (Vitest setup: `lib/health.ts` and `lib/env.ts` must not import `pg` so the jsdom environment stays clean.)

- [ ] **Step 8: Run the e2e suite against the server**

Run: `npx playwright install chromium` (once), then `npm run test:e2e`
Expected: PASS. If the `/404.html` assertion fails because `next start` returns a different page, change that line in `tests/e2e/site.spec.ts` to `await page.goto('/a-page-that-does-not-exist/')` and re-run; the expected heading `This spark wandered off.` is unchanged.

- [ ] **Step 9: Commit**

```bash
git add next.config.ts package.json package-lock.json lib/env.ts lib/health.ts app/api/health/route.ts tests/unit/health.test.ts tests/e2e/site.spec.ts
git commit -m "feat: run as standalone server with /api/health"
```

---

### Task 2: Transactional email through MailerSend

**Files:**
- Create: `lib/email.ts`
- Create: `scripts/send-test-email.ts`
- Modify: `package.json` (script `email:test`)
- Modify: `.env.example` (add `MAILERSEND_API_TOKEN=`, `MAIL_FROM=hello@sparkkindly.com`, `DATABASE_URL=`)
- Test: `tests/unit/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(msg: {to: string; subject: string; text: string; html?: string}, deps?: {fetch?: typeof fetch; env?: NodeJS.ProcessEnv}): Promise<{id: string}>` in `lib/email.ts`. Posts to `https://api.mailersend.com/v1/email` with header `Authorization: Bearer <MAILERSEND_API_TOKEN>`, body `{from:{email:MAIL_FROM,name:'SparkKindly'},to:[{email:to}],subject,text,html}`. Throws `EmailNotConfiguredError` when `MAILERSEND_API_TOKEN` or `MAIL_FROM` is missing; throws `EmailSendError` with the response status when the API returns non-2xx. Returns the `x-message-id` response header as `id`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/email.test.ts
import {describe,it,expect,vi} from 'vitest';
import {sendEmail,EmailNotConfiguredError,EmailSendError} from '@/lib/email';
const env={MAILERSEND_API_TOKEN:'tok',MAIL_FROM:'hello@sparkkindly.com'};
describe('sendEmail',()=>{
 it('posts to MailerSend with bearer token and returns the message id',async()=>{
  const fetch=vi.fn(async()=>new Response(null,{status:202,headers:{'x-message-id':'m-1'}}));
  const r=await sendEmail({to:'a@example.com',subject:'Hi',text:'Hello'},{fetch,env});
  expect(r).toEqual({id:'m-1'});
  const [url,init]=fetch.mock.calls[0];
  expect(url).toBe('https://api.mailersend.com/v1/email');
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(JSON.parse(init.body)).toEqual({from:{email:'hello@sparkkindly.com',name:'SparkKindly'},to:[{email:'a@example.com'}],subject:'Hi',text:'Hello'});
 });
 it('throws EmailNotConfiguredError without a token',async()=>{
  await expect(sendEmail({to:'a@example.com',subject:'x',text:'y'},{fetch:vi.fn(),env:{MAIL_FROM:'h@s.com'}})).rejects.toBeInstanceOf(EmailNotConfiguredError);
 });
 it('throws EmailSendError on a non-2xx response',async()=>{
  const fetch=vi.fn(async()=>new Response('nope',{status:422}));
  await expect(sendEmail({to:'a@example.com',subject:'x',text:'y'},{fetch,env})).rejects.toMatchObject({name:'EmailSendError',status:422});
 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/email.test.ts`
Expected: FAIL — cannot resolve `@/lib/email`.

- [ ] **Step 3: Implement `lib/email.ts`**

Two error classes with `name` set; `sendEmail` as specified. `html` is included in the body only when provided. Default `fetch` is `globalThis.fetch`, default `env` is `process.env`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/email.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the manual test script**

`scripts/send-test-email.ts`: reads the recipient from `process.argv[2]`, loads `.env.local` if present (use `process.loadEnvFile('.env.local')` in a try/catch; Node 24 has it), calls `sendEmail({to, subject:'SparkKindly test email', text:'If you can read this, MailerSend is configured.'})`, prints the id. `package.json`: `"email:test": "tsx scripts/send-test-email.ts"`.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts scripts/send-test-email.ts tests/unit/email.test.ts package.json .env.example
git commit -m "feat: send transactional email through MailerSend"
```

(The live send happens in Task 10 once the owner's MailerSend domain is verified.)

---

### Task 3: VM base provisioning (updates, swap, user, Node 24)

**Files:**
- Create: `deploy/provision/01-base.sh` (run as root on the VM; idempotent)
- Create: `docs/OPERATIONS.md` (section "VM layout")

**Interfaces:**
- Produces on the VM: user `sparkkindly` (system user, home `/opt/sparkkindly`, shell `/bin/bash`); directories `/opt/sparkkindly/{releases,shared,bin,node}`, `/opt/sparkkindly-staging/releases`; Node at `/opt/sparkkindly/node/bin/node` (v24.22.0); 2 GB swap at `/swapfile`; `unattended-upgrades` enabled.

- [ ] **Step 1: Write the script**

`deploy/provision/01-base.sh`, `set -euo pipefail`, each block guarded so re-running changes nothing:
1. `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade`; then `apt-get -y install unattended-upgrades age rclone curl xz-utils` and `dpkg-reconfigure -f noninteractive unattended-upgrades`.
2. Swap: if `/swapfile` is absent, `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`; `sysctl -w vm.swappiness=10` and persist in `/etc/sysctl.d/90-sparkkindly.conf`.
3. User: `id sparkkindly || useradd --system --create-home --home-dir /opt/sparkkindly --shell /bin/bash sparkkindly`; `install -d -o sparkkindly -g sparkkindly /opt/sparkkindly/{releases,bin} /opt/sparkkindly-staging/releases`; `install -d -o root -g sparkkindly -m 750 /opt/sparkkindly/shared`.
4. Node: if `/opt/sparkkindly/node/bin/node --version` is not `v24.22.0`: download `https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-x64.tar.xz` and `SHASUMS256.txt` to `/tmp`, `grep node-v24.22.0-linux-x64.tar.xz SHASUMS256.txt | sha256sum -c -`, extract into `/opt/sparkkindly/node` with `--strip-components=1`, `chown -R root:root`.
5. Print `cat /var/run/reboot-required 2>/dev/null || echo 'No reboot required'`.

- [ ] **Step 2: Copy to the VM and run it**

Run (from the dev machine, PowerShell): `scp deploy/provision/01-base.sh root@2.25.121.2:/root/` then `ssh root@2.25.121.2 'bash /root/01-base.sh'`
Expected: completes without error; last line is either `No reboot required` or `*** System restart required ***`.

- [ ] **Step 3: If a reboot is required, reboot inside the owner's agreed window**

Run: `ssh root@2.25.121.2 'reboot'`; wait 60 s; `ssh root@2.25.121.2 'uptime; systemctl is-active caddy mongod'`
Expected: uptime under 2 minutes; `active` twice. Check `https://myluxvacation` responds (ask the owner for the URL if not obvious from the Caddyfile).

- [ ] **Step 4: Verify the result**

Run: `ssh root@2.25.121.2 'swapon --show; id sparkkindly; id sparkkindly-staging; ls -ld /opt/sparkkindly /opt/sparkkindly/bin /opt/sparkkindly/shared /opt/sparkkindly/home/sparkkindly/.ssh /opt/sparkkindly/app /opt/sparkkindly-staging; /opt/sparkkindly/node/bin/node --version; systemctl is-enabled unattended-upgrades; ufw status | head -3'`
Expected: a 2G swap line; two distinct uids; `/opt/sparkkindly`, `bin` and `.ssh` are `root root`; `shared` is `drwx--x--x root root`; `app` is `sparkkindly sparkkindly` and `/opt/sparkkindly-staging` is `sparkkindly-staging sparkkindly-staging`; `v24.22.0`; `enabled`; `Status: active`.

- [ ] **Step 5: Re-run the script to prove idempotence**

Run: `ssh root@2.25.121.2 'bash /root/01-base.sh'`
Expected: completes without error; no second swap entry (`grep -c swapfile /etc/fstab` prints `1`).

- [ ] **Step 6: Document and commit**

Add to `docs/OPERATIONS.md` a "VM layout" section listing the paths, user, ports and the rule that MyLuxVacation and the Caddyfile body are never touched.

```bash
git add deploy/provision/01-base.sh docs/OPERATIONS.md
git commit -m "ops: VM base provisioning (updates, swap, sparkkindly user, Node 24)"
```

---

### Task 4: PostgreSQL 16 and environment files

**Files:**
- Create: `deploy/provision/02-postgres.sh`
- Create: `deploy/env/prod.env.example`, `deploy/env/staging.env.example`
- Modify: `docs/OPERATIONS.md` (section "Database and environment files")

**Interfaces:**
- Produces on the VM: PostgreSQL 16 on 127.0.0.1:5432; roles `sparkkindly` and `sparkkindly_staging` (each with its own password in `/opt/sparkkindly/shared/db-prod.pass` and `db-staging.pass`, mode 600 root), each owning only its own database (`sparkkindly`, `sparkkindly_staging`), `CONNECT` revoked from `PUBLIC`; `/opt/sparkkindly/shared/prod.env` (mode 640, `root:sparkkindly`) and `staging.env` (mode 640, `root:sparkkindly-staging`) containing `NODE_ENV=production`, `PORT=3100|3101`, `HOSTNAME=127.0.0.1`, `DATABASE_URL=postgres://<role>:<that role's pass>@127.0.0.1:5432/<its database>`, `MAIL_FROM=hello@sparkkindly.com`, `MAILERSEND_API_TOKEN=pending` (a placeholder so `/api/health` passes before the real token arrives; Task 10 replaces it), `SITE_RELEASE=true|false`.

- [ ] **Step 1: Write the script**

`deploy/provision/02-postgres.sh`, root, idempotent: `apt-get -y install postgresql`; confirm `pg_lsclusters` shows a 16 cluster; for each of prod and staging: generate that environment's password once (`openssl rand -hex 24`, mode 600 root), create its role if missing and sync the password, create its database if missing owned by that role, `REVOKE CONNECT ... FROM PUBLIC`, and write its env file from the `.example` template only if absent (`root:<that environment's OS user>`, mode 640); assert via `ss` that port 5432 is bound to loopback only.

- [ ] **Step 2: Run it**

Run: `scp -r deploy/provision deploy/env root@2.25.121.2:/root/ && ssh root@2.25.121.2 'bash /root/provision/02-postgres.sh'`
Expected: completes; prints the `ss` line with `127.0.0.1:5432`.

- [ ] **Step 3: Verify each environment reaches its own database and cannot reach the other's**

Run: `ssh root@2.25.121.2 'P=/opt/sparkkindly/shared; for pair in sparkkindly:sparkkindly:prod sparkkindly:sparkkindly_staging:prod sparkkindly_staging:sparkkindly_staging:staging sparkkindly_staging:sparkkindly:staging; do IFS=: read role db pw <<<"$pair"; printf "%s -> %s: " $role $db; PGPASSWORD=$(cat $P/db-$pw.pass) psql -h 127.0.0.1 -U $role -d $db -tAc "select current_database()" 2>&1 | head -1; done; ls -l $P'`
Expected: `sparkkindly -> sparkkindly: sparkkindly` and `sparkkindly_staging -> sparkkindly_staging: sparkkindly_staging` succeed; the two crossed pairs print `permission denied for database` (or `FATAL`). The listing shows `prod.env` as `-rw-r----- root sparkkindly`, `staging.env` as `-rw-r----- root sparkkindly-staging`, and both `.pass` files `-rw------- root root`.

- [ ] **Step 4: Verify each user reads only its own env file**

Run: `ssh root@2.25.121.2 'for u in sparkkindly sparkkindly-staging nobody; do for f in prod staging; do printf "%s reads %s.env: " $u $f; runuser -u $u -- cat /opt/sparkkindly/shared/$f.env >/dev/null 2>&1 && echo yes || echo no; done; done'`
Expected: `sparkkindly reads prod.env: yes`, `sparkkindly-staging reads staging.env: yes`, and `no` for the other four lines (`shared/` is `root:root 711`: traversable, not listable, each file guarded by its own group).

- [ ] **Step 5: Document and commit**

```bash
git add deploy/provision/02-postgres.sh deploy/env docs/OPERATIONS.md
git commit -m "ops: PostgreSQL 16 role, databases and environment files"
```

---

### Task 5: systemd services and the release receiver

**Files:**
- Create: `deploy/systemd/sparkkindly-web.service`, `deploy/systemd/sparkkindly-web-staging.service`
- Create: `deploy/bin/deploy-receive.sh` (installed to `/opt/sparkkindly/bin/`)
- Create: `deploy/provision/03-services.sh` (installs units, sudoers, bin scripts, authorized_keys)
- Create: `deploy/sudoers.d/sparkkindly`
- Modify: `docs/OPERATIONS.md` (section "Deploy and rollback")

**Interfaces:**
- Produces: `deploy-receive.sh <prod|staging>` reads a gzipped tarball on **stdin**; the target is its first argument, fixed per login by the forced command (the client's own command is ignored; an unknown argument → exit 2). Layout per target: `ROOT=/opt/sparkkindly/app` or `/opt/sparkkindly-staging`, `SERVICE=sparkkindly-web` or `sparkkindly-web-staging`, `PORT=3100` or `3101`. Behaviour: `NEW=$ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$(cat RELEASE | cut -c1-7)`; extract to a temp dir, require `server.js` and `RELEASE` to exist, move into place; if `$ROOT/current/migrate.sh` exists in the new release, run it (hook for Project 1; absent now); `ln -sfn $NEW $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current`; `sudo systemctl restart $SERVICE`; poll `curl -fsS http://127.0.0.1:$PORT/api/health` up to 30 times, 1 s apart; on success write the old target into `$ROOT/previous` (a symlink) and prune releases beyond the newest 5; on failure switch `current` back to the old target, restart, print the last 50 lines of the service's journal via `sudo journalctl -u $SERVICE -n 50 --no-pager`, exit 1.
- Produces: one deploy SSH key pair, installed for **both** logins as root-owned files in root-owned directories: `/opt/sparkkindly/home/sparkkindly/.ssh/authorized_keys` with `command="/opt/sparkkindly/bin/deploy-receive.sh prod",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 …` and `/opt/sparkkindly/home/sparkkindly-staging/.ssh/authorized_keys` with `… deploy-receive.sh staging …`. Private key goes to GitHub secret `VPS_SSH_KEY` in Task 6; the login name picks the target (`sparkkindly` → prod, `sparkkindly-staging` → staging).
- Produces: `/etc/sudoers.d/sparkkindly`: each user may run exactly `systemctl restart <its own service>` and `journalctl -u <its own service> -n 50 --no-pager` with no password (no `systemd-journal` group).
- Unit files: `User=sparkkindly` (staging: `sparkkindly-staging`), `EnvironmentFile=/opt/sparkkindly/shared/prod.env` (staging: `staging.env`), `WorkingDirectory=/opt/sparkkindly/app/current` (staging: `/opt/sparkkindly-staging/current`), `ExecStart=/opt/sparkkindly/node/bin/node server.js`, `Restart=always`, `RestartSec=2`, `MemoryMax=1G` (staging `512M`), `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`, `WantedBy=multi-user.target`.

- [ ] **Step 1: Write the unit files, receiver, sudoers file and `03-services.sh`**

`03-services.sh` (root, idempotent): copies units to `/etc/systemd/system/`, `daemon-reload`, `enable` both (not start; nothing deployed yet); installs `deploy-receive.sh` to `/opt/sparkkindly/bin/` mode 755 root; installs the sudoers file mode 440 and validates with `visudo -cf`; writes each login's root-owned `authorized_keys` (644) from a public key passed as `$1`, with that login's forced-command prefix above.

- [ ] **Step 2: Generate the deploy key on the dev machine and provision**

Run (PowerShell): `ssh-keygen -t ed25519 -N '""' -C sparkkindly-deploy -f $env:USERPROFILE\.ssh\sparkkindly-deploy` then `scp -r deploy root@2.25.121.2:/root/ && ssh root@2.25.121.2 "bash /root/deploy/provision/03-services.sh '$(Get-Content $env:USERPROFILE\.ssh\sparkkindly-deploy.pub)'"`
Expected: `visudo` prints nothing (valid); `systemctl is-enabled sparkkindly-web sparkkindly-web-staging` prints `enabled` twice.

- [ ] **Step 3: Build a release tarball locally and deliver it to staging through the forced command**

Run (PowerShell, repo root): `$env:SITE_RELEASE='false'; npm run build` (staging builds are noindex: `robots.ts` and `sitemap.ts` are prerendered at build time, so the flag must be set when building, not only at runtime); then assemble: `Remove-Item -Recurse -Force release -ErrorAction SilentlyContinue; New-Item -ItemType Directory release | Out-Null; Copy-Item -Recurse .next/standalone/* release/; Copy-Item -Recurse .next/static release/.next/static; Copy-Item -Recurse public release/public; git rev-parse HEAD | Out-File -Encoding ascii -NoNewline release/RELEASE; tar -czf release.tgz -C release .`; then `Get-Content -Raw -AsByteStream release.tgz | ssh -i $env:USERPROFILE\.ssh\sparkkindly-deploy sparkkindly-staging@2.25.121.2 anything` (the command word is ignored; the login picks the target)
Expected: output ends with `Healthy: staging <sha7>`; exit code 0.

(The `build` script runs `content:validate` first; with `SITE_RELEASE=false` it runs in preview mode and passes on unchanged content.)

- [ ] **Step 4: Verify the service, the symlinks and the health endpoint**

Run: `ssh root@2.25.121.2 'systemctl is-active sparkkindly-web-staging; readlink /opt/sparkkindly-staging/current; curl -s http://127.0.0.1:3101/api/health'`
Expected: `active`; a path under `releases/`; `{"ok":true,"release":"<sha7>","db":"ok","missingEnv":[]}` (the `pending` placeholder from Task 4 keeps `missingEnv` empty until Task 10).

- [ ] **Step 5: Test Review Focus 2 — garbage on stdin leaves `current` untouched**

Run: `$before = ssh root@2.25.121.2 'readlink /opt/sparkkindly-staging/current'; 'not a tarball' | ssh -i $env:USERPROFILE\.ssh\sparkkindly-deploy sparkkindly-staging@2.25.121.2 anything; echo "exit=$LASTEXITCODE"; ssh root@2.25.121.2 'readlink /opt/sparkkindly-staging/current'`
Expected: non-zero exit; the two `readlink` outputs are identical; `ls /opt/sparkkindly-staging/releases | wc -l` has not grown.

- [ ] **Step 6: Test Review Focus 1 — a release that fails health is rolled back and never becomes `previous`**

Run: create a tarball whose `server.js` is just `process.exit(1)` (copy `release/` to `release-bad/`, overwrite `release-bad/server.js` with that one line, `tar -czf release-bad.tgz -C release-bad .`), and deliver it as `sparkkindly-staging` the same way as Step 3.
Expected: output contains `Health check failed, rolling back`, exit 1; `readlink current` equals the good release; `readlink previous` is unchanged from before (or absent if this was the first deploy); `systemctl is-active sparkkindly-web-staging` is `active`; `curl -s http://127.0.0.1:3101/api/health` is `ok:true`.

- [ ] **Step 7: Test that the staging login cannot deploy production, whatever the client asks for**

Run: `$before = ssh root@2.25.121.2 'readlink /opt/sparkkindly/app/current 2>/dev/null; ls /opt/sparkkindly/app/releases | wc -l'; Get-Content -Raw -AsByteStream release.tgz | ssh -i $env:USERPROFILE\.ssh\sparkkindly-deploy sparkkindly-staging@2.25.121.2 prod; ssh root@2.25.121.2 'readlink /opt/sparkkindly/app/current 2>/dev/null; ls /opt/sparkkindly/app/releases | wc -l'`
Expected: the deploy lands on **staging** (output says `Healthy: staging …`), and the two prod lines (symlink and release count) are identical before and after. Then `ssh root@2.25.121.2 'runuser -u sparkkindly-staging -- touch /opt/sparkkindly/bin/x /opt/sparkkindly/home/sparkkindly-staging/.ssh/x 2>&1 | grep -c "Permission denied"'` prints `2`: the staging user cannot write the deploy script or its own key directory.

- [ ] **Step 8: Build a release tarball for prod and verify it runs on 3100 but is not reachable from the internet**

Run: `$env:SITE_RELEASE='true'; npm run build`, assemble and tar exactly as in Step 3, deliver as login `sparkkindly@2.25.121.2` (which is pinned to prod); then `ssh root@2.25.121.2 'curl -s http://127.0.0.1:3100/api/health; ss -tlnp | grep 3100'` and from the dev machine `curl -s -o /dev/null -w '%{http_code}' https://sparkkindly.com/api/health`
Expected: `ok:true`; `127.0.0.1:3100` only; the public URL returns the mock-up's **404** page status (Caddy still serves the static export).

- [ ] **Step 9: Document and commit**

Write "Deploy and rollback" in `docs/OPERATIONS.md`: how a release is delivered, where it lands, how to roll back by hand (`ln -sfn $(readlink previous) current.tmp && mv -T current.tmp current && sudo systemctl restart sparkkindly-web`), and how to read logs (`journalctl -u sparkkindly-web -n 100`).

```bash
git add deploy/systemd deploy/bin/deploy-receive.sh deploy/provision/03-services.sh deploy/sudoers.d docs/OPERATIONS.md
git commit -m "ops: systemd services and forced-command release receiver with rollback"
```

---

### Task 6: GitHub Actions deploys `main` to prod and `staging` to staging

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `docs/OPERATIONS.md` (section "Pipeline")
- Unchanged: `.github/workflows/ci.yml` stays the check workflow for pushes and pull requests (lint, typecheck, unit, both e2e runs).

**Interfaces:**
- Consumes: the tarball layout and the `prod`/`staging` targets from Task 5.
- Produces: workflow `Deploy` triggered on `push` to `main` and `staging`. One job per run with `TARGET=$([ "$GITHUB_REF_NAME" = main ] && echo prod || echo staging)` and `SITE_RELEASE` set to `true` for `main` and `false` for `staging` on the build step. Steps: `npm ci`, `content:validate`, `lint`, `typecheck`, `test -- --run`, `build`; assemble `release/` exactly as Task 5 Step 3 (bash equivalents) and `tar czf release.tgz -C release .`; write secret `VPS_SSH_KEY` to a file (mode 600) and secret `VPS_KNOWN_HOSTS` to `~/.ssh/known_hosts` (a pinned host key, never trust-on-first-use); `ssh -i key $DEPLOY_USER@$VPS_HOST deploy < release.tgz` with `DEPLOY_USER=sparkkindly` for `main` and `sparkkindly-staging` for `staging` (the login, not the command, picks the target). Concurrency group `deploy-$TARGET`, `cancel-in-progress: false`. `timeout-minutes: 15`.
- Secrets: `VPS_HOST` (`2.25.121.2`), `VPS_SSH_KEY` (private key from Task 5), `VPS_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 2.25.121.2`).

- [ ] **Step 1: Write `deploy.yml`**

As specified. Use `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`. E2E is not run in the deploy workflow (it runs in `ci.yml`); the deploy's own gate is the health check on the VM.

- [ ] **Step 2: Add the secrets**

Run (PowerShell): `gh auth status` — if authenticated: `gh secret set VPS_HOST -b 2.25.121.2; gh secret set VPS_SSH_KEY < $env:USERPROFILE\.ssh\sparkkindly-deploy; ssh-keyscan -t ed25519 2.25.121.2 | gh secret set VPS_KNOWN_HOSTS`. If `gh` is unavailable, paste the three values at `https://github.com/myluxvacay/sparkkindly.com/settings/secrets/actions`.
Expected: `gh secret list` shows the three names.

- [ ] **Step 3: Create the `staging` branch and push both branches**

Run: `git add .github/workflows/deploy.yml docs/OPERATIONS.md; git commit -m "ci: deploy main to prod and staging to staging over SSH"; git push origin main; git branch -f staging main; git push -u origin staging`
Expected: two `Deploy` runs appear.

- [ ] **Step 4: Verify both runs and the timing**

Run: `gh run list --workflow Deploy --limit 2` and `gh run view <id>` for each
Expected: both `completed success`; total duration under 10 minutes each; the deploy step log ends with `Healthy: prod <sha7>` and `Healthy: staging <sha7>`. On the VM: `readlink /opt/sparkkindly/app/current` ends with the pushed commit's short SHA.

- [ ] **Step 5: Verify a failing check blocks the deploy**

Run: on a throwaway branch from `staging`, introduce a TypeScript error in `lib/health.ts`, push to `staging`, watch the run.
Expected: `check` fails at `typecheck`; `deploy` is skipped; staging still serves the previous release. Revert the commit and push; staging deploys again.

- [ ] **Step 6: Document**

"Pipeline" in `docs/OPERATIONS.md`: what triggers what, the secrets and where they live, how to rotate the deploy key (new keypair → `03-services.sh` with the new public key → update `VPS_SSH_KEY`). Commit with the revert from Step 5.

---

### Task 7: Staging site behind Caddy with basic auth and noindex

**Files:**
- Create: `deploy/caddy/sparkkindly-staging.caddy`
- Create: `deploy/provision/04-caddy-staging.sh`
- Modify: `docs/OPERATIONS.md` (section "Staging")

**Interfaces:**
- Consumes: owner has created DNS `A staging.sparkkindly.com → 2.25.121.2`.
- Produces: `/etc/caddy/sparkkindly-staging.caddy`:
  ```
  staging.sparkkindly.com {
      basic_auth {
          {$SPARKKINDLY_STAGING_USER} {$SPARKKINDLY_STAGING_HASH}
      }
      reverse_proxy 127.0.0.1:3101
      header -Server
  }
  ```
  (If Caddy's environment substitution for `basic_auth` is awkward in 2.11, write the user and hash literally into the file; the file is root-only and not in the repo. The repo copy keeps placeholders.)
- Produces: one line `import /etc/caddy/sparkkindly-staging.caddy` appended to **both** `/etc/caddy/Caddyfile` and `/opt/myluxvacation/deploy/Caddyfile`, so the two stay identical as `activate-public.py` requires.
- Produces: staging credentials: user `sparkkindly`, a 24-char random password, stored in `/opt/sparkkindly/shared/staging-basic-auth.txt` (600 root) and given to the owner.

- [ ] **Step 1: Confirm DNS**

Run: `nslookup staging.sparkkindly.com`
Expected: `2.25.121.2`. If not, stop and ask the owner to add the record; Caddy cannot obtain a certificate otherwise.

- [ ] **Step 2: Write the snippet and `04-caddy-staging.sh`**

Script (root, idempotent): back up `/etc/caddy/Caddyfile` to `Caddyfile.bak-<date>`; generate the password if the credentials file is absent; `HASH=$(caddy hash-password --plaintext "$PASS")`; write the snippet with literal user and hash; append the import line to both Caddyfiles only if absent (`grep -qxF`); `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`; `systemctl reload caddy`. If `validate` fails, restore the backup and exit 1 without reloading.

- [ ] **Step 3: Run it**

Run: `scp -r deploy root@2.25.121.2:/root/ && ssh root@2.25.121.2 'bash /root/deploy/provision/04-caddy-staging.sh && diff /etc/caddy/Caddyfile /opt/myluxvacation/deploy/Caddyfile && echo SAME'`
Expected: `Valid configuration`, `SAME`.

- [ ] **Step 4: Test Review Focus 5 — unauthenticated requests are refused; authenticated staging is noindex**

Run: `curl -s -o /dev/null -w '%{http_code}\n' https://staging.sparkkindly.com/api/health` then `curl -s -u sparkkindly:<password> https://staging.sparkkindly.com/robots.txt` and `curl -s -u sparkkindly:<password> https://staging.sparkkindly.com/sitemap.xml | grep -c '<url>'`
Expected: `401`; `Disallow: /`; `0`.

- [ ] **Step 5: Confirm MyLuxVacation and the mock-up are unaffected**

Run: `curl -s -o /dev/null -w '%{http_code}\n' https://sparkkindly.com/` and the MyLuxVacation URL
Expected: `200` for both.

- [ ] **Step 6: Document and commit**

```bash
git add deploy/caddy/sparkkindly-staging.caddy deploy/provision/04-caddy-staging.sh docs/OPERATIONS.md
git commit -m "ops: staging site behind Caddy basic auth"
```

---

### Task 8: Nightly encrypted backups to Backblaze B2

**Files:**
- Create: `deploy/bin/backup.sh`
- Create: `deploy/systemd/sparkkindly-backup.service`, `deploy/systemd/sparkkindly-backup.timer`
- Create: `deploy/provision/05-backups-and-monitoring.sh` (Tasks 9 and 11 extend it)
- Modify: `docs/OPERATIONS.md` (section "Backups")

**Interfaces:**
- Consumes: owner's B2 key ID and application key; Better Stack heartbeat URL for `sparkkindly-backup`.
- Produces: `/opt/sparkkindly/shared/backup.env` (600 root): `B2_ACCOUNT_ID`, `B2_APP_KEY`, `B2_BUCKET=sparkkindly-backups`, `AGE_RECIPIENT=<public key>`, `HEARTBEAT_BACKUP_URL`. `/root/.config/rclone/rclone.conf` with remote `b2` of type `b2`. Age key pair: `/root/.config/sparkkindly/age.key` (600) holding the private key; the owner stores a copy in their password manager (the restore test and any real restore need it).
- Produces: `backup.sh` (root): `set -euo pipefail`; `FILE=/var/backups/sparkkindly/sparkkindly-$(date -u +%Y%m%dT%H%M%SZ).dump.age`; `runuser -u postgres -- pg_dump -Fc sparkkindly | age -r "$AGE_RECIPIENT" -o "$FILE"`; `test $(stat -c %s "$FILE") -ge 10240 || { echo 'Backup too small'; rm -f "$FILE"; exit 1; }`; `rclone copy "$FILE" b2:$B2_BUCKET/db/`; `rclone delete --min-age 30d b2:$B2_BUCKET/db/`; remove local files older than 2 days; `curl -fsS -m 10 "$HEARTBEAT_BACKUP_URL" > /dev/null`. Only on full success is the heartbeat pinged.
- Timer: `OnCalendar=*-*-* 03:15:00 UTC`, `Persistent=true`.

- [ ] **Step 1: Write the scripts and units; `05-backups-and-monitoring.sh` installs them**

`05-backups-and-monitoring.sh` (root, idempotent): `install -d -m 700 /var/backups/sparkkindly /root/.config/sparkkindly`; if `age.key` is absent, `age-keygen -o /root/.config/sparkkindly/age.key` and print the public key with the instruction to store the private key in the owner's password manager; write `backup.env` from arguments or prompt-free env vars (`B2_ACCOUNT_ID`, `B2_APP_KEY`, `HEARTBEAT_BACKUP_URL` passed on the command line); write `rclone.conf` via `rclone config create b2 b2 account "$B2_ACCOUNT_ID" key "$B2_APP_KEY"`; install `backup.sh` to `/opt/sparkkindly/bin/`, the units, `daemon-reload`, `enable --now sparkkindly-backup.timer`.

- [ ] **Step 2: Provision**

Run: `scp -r deploy root@2.25.121.2:/root/ && ssh root@2.25.121.2 'B2_ACCOUNT_ID=… B2_APP_KEY=… HEARTBEAT_BACKUP_URL=… bash /root/deploy/provision/05-backups-and-monitoring.sh'` (values from the owner, typed into the terminal, not stored in the repo or chat logs)
Expected: prints `Public key: age1…` and `Store the private key in your password manager`; `systemctl list-timers | grep sparkkindly-backup` shows the next 03:15 UTC run.

- [ ] **Step 3: Run a backup by hand**

Run: `ssh root@2.25.121.2 'systemctl start sparkkindly-backup.service; journalctl -u sparkkindly-backup -n 20 --no-pager; rclone ls b2:sparkkindly-backups/db/'`
Expected: journal shows no errors and a `Transferred:` line; `rclone ls` lists one `.dump.age` file ≥ 10 KB. In Better Stack, the `sparkkindly-backup` heartbeat shows a check-in within the last minute.

- [ ] **Step 4: Test Review Focus 3 — a failed dump uploads nothing and pings nothing**

Run: `ssh root@2.25.121.2 'sed "s/pg_dump -Fc sparkkindly/pg_dump -Fc does_not_exist/" /opt/sparkkindly/bin/backup.sh > /tmp/bad-backup.sh; bash /tmp/bad-backup.sh; echo exit=$?; rclone ls b2:sparkkindly-backups/db/ | wc -l'`
Expected: an error from `pg_dump`, `exit=1`, the file count unchanged from Step 3, and no new heartbeat check-in in Better Stack.

- [ ] **Step 5: Document and commit**

"Backups" in `docs/OPERATIONS.md`: schedule, where files go, how to list them, the age key and where its copy lives, how to change retention.

```bash
git add deploy/bin/backup.sh deploy/systemd/sparkkindly-backup.* deploy/provision/05-backups-and-monitoring.sh docs/OPERATIONS.md
git commit -m "ops: nightly encrypted PostgreSQL backups to Backblaze B2 with heartbeat"
```

---

### Task 9: Restore script and monthly automated restore test

**Files:**
- Create: `deploy/bin/restore.sh`
- Create: `deploy/bin/restore-test.sh`
- Create: `deploy/systemd/sparkkindly-restore-test.service`, `deploy/systemd/sparkkindly-restore-test.timer`
- Modify: `deploy/provision/05-backups-and-monitoring.sh` (installs these too)
- Modify: `docs/OPERATIONS.md` (section "Restore")

**Interfaces:**
- Produces: `restore.sh <file-or-b2-path> <target-db>` (root): if the first argument starts with `b2:`, `rclone copy` it to `/var/backups/sparkkindly/restore/`; `age -d -i /root/.config/sparkkindly/age.key "$FILE" > "$FILE.dump"`; `runuser -u postgres -- dropdb --if-exists "$DB"`; `createdb -O sparkkindly "$DB"`; `pg_restore -d "$DB" --no-owner --role=sparkkindly "$FILE.dump"`; prints `Restored <file> into <db>`. Refuses `sparkkindly` and `sparkkindly_staging` as targets unless `--force` is the third argument.
- Produces: `restore-test.sh` (root): picks the newest object in `b2:sparkkindly-backups/db/`, calls `restore.sh` into `sparkkindly_restoretest`, runs `psql -d sparkkindly_restoretest -tc "select count(*) from pg_tables where schemaname='public'"` and requires the count to equal the same query against `sparkkindly`, drops the test database, pings `HEARTBEAT_RESTORE_URL`. Timer: `OnCalendar=*-*-01 04:00:00 UTC`, `Persistent=true`. `backup.env` gains `HEARTBEAT_RESTORE_URL`.

- [ ] **Step 1: Write both scripts and the units; extend `05-backups-and-monitoring.sh`**

- [ ] **Step 2: Provision and run the restore test by hand (this is the spec's "restored once successfully")**

Run: `scp -r deploy root@2.25.121.2:/root/ && ssh root@2.25.121.2 'HEARTBEAT_RESTORE_URL=… bash /root/deploy/provision/05-backups-and-monitoring.sh && systemctl start sparkkindly-restore-test.service && journalctl -u sparkkindly-restore-test -n 20 --no-pager'`
Expected: `Restored … into sparkkindly_restoretest`, `Table count matches: 0` (no tables yet), `Dropped sparkkindly_restoretest`; the `sparkkindly-restore-test` heartbeat checks in.

- [ ] **Step 3: Test the safety refusal**

Run: `ssh root@2.25.121.2 '/opt/sparkkindly/bin/restore.sh b2:sparkkindly-backups/db/<newest> sparkkindly; echo exit=$?'`
Expected: `Refusing to overwrite sparkkindly without --force`, `exit=3`.

- [ ] **Step 4: Document and commit**

"Restore" in `docs/OPERATIONS.md`: the exact command for a real restore (`restore.sh b2:… sparkkindly --force` after stopping `sparkkindly-web`), what the monthly test proves, and the recovery targets from the spec (24 h data loss, 4 h outage).

```bash
git add deploy/bin/restore.sh deploy/bin/restore-test.sh deploy/systemd/sparkkindly-restore-test.* deploy/provision/05-backups-and-monitoring.sh docs/OPERATIONS.md
git commit -m "ops: restore script and monthly automated restore test"
```

---

### Task 10: MailerSend domain verification and the first real email

**Files:**
- Modify: `/opt/sparkkindly/shared/prod.env`, `staging.env` on the VM (token), via a small `deploy/bin/set-env.sh KEY VALUE FILE` helper that edits in place and never echoes the value
- Modify: `docs/OPERATIONS.md` (section "Email")

**Interfaces:**
- Consumes: `sendEmail` from Task 2; the owner's MailerSend API token; DNS records added by the owner.

- [ ] **Step 1: Confirm the domain is verified**

Run: `nslookup -type=TXT sparkkindly.com` and the DKIM/return-path names MailerSend gave; check MailerSend's domain page shows **Verified**.
Expected: SPF includes MailerSend's include; DKIM CNAME resolves; `_dmarc.sparkkindly.com` TXT begins `v=DMARC1`. If MailerSend shows unverified, stop and give the owner the exact missing record.

- [ ] **Step 2: Send a test email from the dev machine**

Run: put `MAILERSEND_API_TOKEN=…` and `MAIL_FROM=hello@sparkkindly.com` in `.env.local` (gitignored), then `npm run email:test -- <owner's address>`
Expected: prints a message id; the owner receives the email from `hello@sparkkindly.com` and it is not in spam; the headers show `spf=pass` and `dkim=pass`.

- [ ] **Step 3: Put the token on the VM and redeploy so health reflects it**

Run: `ssh root@2.25.121.2 'bash /root/deploy/bin/set-env.sh MAILERSEND_API_TOKEN "<token>" /opt/sparkkindly/shared/prod.env && bash /root/deploy/bin/set-env.sh MAILERSEND_API_TOKEN "<token>" /opt/sparkkindly/shared/staging.env && systemctl restart sparkkindly-web sparkkindly-web-staging && curl -s http://127.0.0.1:3100/api/health'`
Expected: `"ok":true` with empty `missingEnv`.

- [ ] **Step 4: Document and commit**

"Email" in `docs/OPERATIONS.md`: provider, sending address, where the token lives, how to rotate it, how to run the test send.

```bash
git add deploy/bin/set-env.sh docs/OPERATIONS.md
git commit -m "ops: MailerSend configuration and env helper"
```

---

### Task 11: Uptime and disk alerts, and the outage drill

**Files:**
- Create: `deploy/bin/check-disk.sh`
- Create: `deploy/systemd/sparkkindly-disk.service`, `deploy/systemd/sparkkindly-disk.timer`
- Modify: `deploy/provision/05-backups-and-monitoring.sh` (installs the disk check; `backup.env` gains `HEARTBEAT_DISK_URL`)
- Modify: `docs/OPERATIONS.md` (section "Monitoring and alerts")

**Interfaces:**
- Produces: `check-disk.sh` (root): `USE=$(df --output=pcent / | tail -1 | tr -dc 0-9)`; exit 1 with a message if `USE -ge 80`; otherwise ping `HEARTBEAT_DISK_URL`. Timer daily at 06:00 UTC.
- Consumes: the Better Stack uptime monitor on `https://staging.sparkkindly.com/api/health` with basic auth (created by the owner from Task 7's credentials; prod's `sparkkindly.com` gets its monitor at the Project 1 cut-over, since today it is the static mock-up).

- [ ] **Step 1: Write the script and units; extend the provisioning script; provision**

Run: `… HEARTBEAT_DISK_URL=… bash /root/deploy/provision/05-backups-and-monitoring.sh && systemctl start sparkkindly-disk.service && journalctl -u sparkkindly-disk -n 5 --no-pager`
Expected: `Disk use 7%`, heartbeat `sparkkindly-disk` checks in.

- [ ] **Step 2: Test the threshold**

Run: `ssh root@2.25.121.2 'sed "s/-ge 80/-ge 1/" /opt/sparkkindly/bin/check-disk.sh | bash; echo exit=$?'`
Expected: `Disk use 7% is at or above threshold`, `exit=1`, no new check-in.

- [ ] **Step 3: The outage drill (the spec's "an intentional outage triggers an alert")**

Run: `ssh root@2.25.121.2 'systemctl stop sparkkindly-web-staging'`; wait for the monitor's interval plus one minute; then `systemctl start sparkkindly-web-staging`.
Expected: the owner receives a Better Stack **down** email naming the staging monitor, then an **up** email after the restart. Record the two timestamps in `docs/OPERATIONS.md`.

- [ ] **Step 4: Document and commit**

"Monitoring and alerts": what is watched, by what, where alerts go, what to do on each alert type (link to the deploy, backup and restore sections), and the drill record.

```bash
git add deploy/bin/check-disk.sh deploy/systemd/sparkkindly-disk.* deploy/provision/05-backups-and-monitoring.sh docs/OPERATIONS.md
git commit -m "ops: disk check heartbeat and alerting runbook"
```

---

### Task 12: Done-when verification and hand-off

**Files:**
- Modify: `README.md` (replace the "Run locally" and "Check and build" sections: Windows-friendly commands, `npm run preview` now starts the server, note that `build:release`/`build:preview` are Unix-only and that `npm run build` is the release build)
- Modify: `docs/OPERATIONS.md` (add "Project 0 verification" with the evidence below)
- Modify: `docs/superpowers/plans/2026-10-30-roadmap-tracker.md` (tick Project 0 tasks)

- [ ] **Step 1: Time an end-to-end deploy**

Run: make a one-line doc change on `main`, push, `gh run watch`.
Expected: `Deploy` completes in under 10 minutes; `curl -s http://127.0.0.1:3100/api/health` on the VM shows the new SHA.

- [ ] **Step 2: Confirm the three done-when criteria with evidence**

- Deploy: run id and duration from Step 1.
- Backup: `rclone ls b2:sparkkindly-backups/db/` output and the restore-test journal line from Task 9.
- Alert: the drill timestamps from Task 11.

- [ ] **Step 3: Confirm nothing else changed**

Run: `ssh root@2.25.121.2 'ufw status | grep -c ALLOW; diff /etc/caddy/Caddyfile /opt/myluxvacation/deploy/Caddyfile && echo SAME; systemctl is-active caddy mongod; curl -s -o /dev/null -w "%{http_code}\n" https://sparkkindly.com/'`
Expected: `6` (the same six rules as before), `SAME`, `active active`, `200`.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/OPERATIONS.md docs/superpowers/plans/2026-10-30-roadmap-tracker.md
git commit -m "docs: Project 0 verification and updated run instructions"
git push origin main
```

---

## Deviations from the spec, recorded

- **Error tracking (Sentry) moved to Project 1.** The spec lists "error tracking in the app" under Project 0. There is no application logic yet to report on, the browser must stay free of third-party requests (so only a server-side SDK is acceptable), and adding the dependency before the real app exists would be scaffolding. It is the first task of Project 1 in the tracker.
- **Backups and checks run as systemd timers, not inside the worker.** The spec says scheduled jobs run "in the worker on the VM". Backups and disk checks must work even when the app is down, so they are system timers. The worker (Project 1) owns application jobs: publishing, digests, scoring, social posting. Both are "on the VM, not the owner's machine", which is the spec's point.
- **The production uptime monitor waits for the Project 1 cut-over.** Monitoring `sparkkindly.com` today would watch the static mock-up; the drill uses the staging monitor.
