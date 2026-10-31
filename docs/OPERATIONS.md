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

## Not yet done

The server has not been rebooted since the library updates, so MongoDB, `sshd` and `systemd` still run the older
loaded libraries (listed by `needrestart`); a reboot is pending the owner's window. Caddy routing for staging and the
cut-over, backups, monitoring and email come in later tasks of the Project 0 plan.
