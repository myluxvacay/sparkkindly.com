# KB-002: The site shows an error page or "This spark wandered off" after a release

Version 1, 1 November 2026. Related: `docs/OPERATIONS.md` (deploy, rollback, health), `docs/CUTOVER.md`.

## Symptom

After a deploy or the cut-over, visitors or the uptime monitor see a generic error page, a 502 or 503 from Caddy, or valid pages return "This spark wandered off" (404).

## Affected

Everyone on the public site. The deploy receiver already rolls back a release that fails its health check, so a persistent fault usually means a database or configuration fault that health did not cover, or a Caddy change.

## Likely causes

1. The web service is down or restarting (`systemctl status sparkkindly-web`).
2. The database is unreachable or empty (the production database is empty until the starter content is imported at cut-over): pages show an empty state and item URLs return 404.
3. Caddy still points at the old static export or at the wrong port after the cut-over change.
4. A required environment value is missing (`/api/health/` reports it to loopback callers).

## Diagnostics

On the VM: `curl -s http://127.0.0.1:3100/api/health/` (trailing slash required); `journalctl -u sparkkindly-web -n 100`; `ls -l /opt/sparkkindly/app/current`; `caddy validate --config /etc/caddy/Caddyfile`; `SELECT count(*) FROM items WHERE status = 'published';`.

## Resolution

1. Service down: `systemctl restart sparkkindly-web` and re-check health.
2. Empty database after cut-over: this is a failed cut-over step; use the rollback in `docs/CUTOVER.md` first, then investigate.
3. Wrong Caddy target: restore the timestamped Caddyfile backup the switch script wrote, validate, reload.
4. Bad release: roll back as in `docs/OPERATIONS.md` ("Manual rollback").

## Workaround

Roll back (step 2 or 4): the previous release or the old static site keeps serving while the fault is investigated.

## Escalate when

Rollback does not restore a 200 within ten minutes, or MyLuxVacation is affected (it must never be): stop and tell the owner.

## Collect

Time of first failure, URL, HTTP status, the health output, the last 100 journal lines. Never include `.env` contents.
