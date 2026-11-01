#!/usr/bin/env bash
# Shared by switch-to-app.sh and rollback-to-static.sh (sourced, never run on its own).
# Holds the one definition of the import lines, the reload helper that reports its own failure, and the post-change
# checks that decide whether the static or the app site really answers.
# Verified by: tests/unit/cutover-scripts.test.ts (exit codes 3 and 4 and the checks).
#
# Exit codes used by both scripts: 1 refused or failed and the previous state is restored and confirmed,
# 2 bad usage, 3 the Caddy reload itself failed (Caddy may be in an unknown state: act now),
# 4 files restored and reloaded but the site checks did not confirm (look at the live site now).

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TEMPLATE="${TEMPLATE:-/opt/myluxvacation/deploy/Caddyfile}"
SNIPPET_DIR="${SNIPPET_DIR:-/etc/caddy}"
BACKUP_ROOT="${BACKUP_ROOT:-/etc/caddy/sparkkindly-backups}"
CADDY="${CADDY:-caddy}"
RELOAD="${RELOAD:-systemctl reload caddy}"
OLD_IMPORT="import ${SNIPPET_DIR}/sparkkindly-public.caddy"
NEW_IMPORT="import ${SNIPPET_DIR}/sparkkindly-public-app.caddy"

# The public site answers, and the neighbouring site is untouched. Commands are eval'd so tests can stub them.
if [ -z "${PUBLIC_CHECK+x}" ]; then PUBLIC_CHECK='curl -fsS --max-time 15 -o /dev/null https://sparkkindly.com/api/health/'; fi
if [ -z "${MLV_CHECK+x}" ]; then MLV_CHECK='curl -fsS --max-time 15 -o /dev/null https://myluxvacation.com/'; fi
# The static export is back: the app's health URL does not exist there (404) and the home page answers 200.
if [ -z "${STATIC_CHECK+x}" ]; then
  STATIC_CHECK='[ "$(curl -s -o /dev/null -w %{http_code} --max-time 15 https://sparkkindly.com/api/health/)" = 404 ] && [ "$(curl -s -o /dev/null -w %{http_code} --max-time 15 https://sparkkindly.com/)" = 200 ]'
fi

need_root() {
  if [ -z "${CADDYFILE_TEST:-}" ] && [ "$(id -u)" != 0 ]; then echo "Run as root on the VM." >&2; exit 2; fi
}

# Number of differing lines between two files (a changed line counts twice: removed and added).
changed_lines() { diff "$1" "$2" | grep -c '^[<>]' || true; }

# Returns 0, or 3 after saying so loudly. Callers must not claim success after a 3.
reload_caddy() {
  if eval "$RELOAD"; then return 0; fi
  echo "RELOAD FAILED: Caddy did not accept the reload. It may still be running its previous configuration or an unknown one. Check 'systemctl status caddy' and 'journalctl -u caddy' NOW." >&2
  return 3
}

# 0 when sparkkindly.com serves the static export again and myluxvacation.com still answers; otherwise 4.
verify_static() {
  eval "$STATIC_CHECK" || { echo "Static site check failed: sparkkindly.com does not look like the static export." >&2; return 4; }
  eval "$MLV_CHECK" || { echo "myluxvacation.com did not answer." >&2; return 4; }
  return 0
}
