#!/usr/bin/env bash
# CUT-OVER ROLLBACK (written, not run). Puts sparkkindly.com back on the static export by restoring the Caddyfiles that
# switch-to-app.sh backed up. The static site (/var/www/sparkkindly/public/current) is never modified by the cut-over,
# so this is one command and takes effect on the Caddy reload. The app keeps running on loopback; no data is touched.
#
#   deploy/cutover/rollback-to-static.sh /etc/caddy/sparkkindly-backups/cutover-YYYYMMDD-HHMMSS
#
# Verified by: tests/unit/cutover-scripts.test.ts (restore from a backup directory; refuses a missing one).
# Same environment overrides as switch-to-app.sh (CADDYFILE, TEMPLATE, SNIPPET_DIR, CADDY, RELOAD).
set -euo pipefail

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TEMPLATE="${TEMPLATE:-/opt/myluxvacation/deploy/Caddyfile}"
SNIPPET_DIR="${SNIPPET_DIR:-/etc/caddy}"
CADDY="${CADDY:-caddy}"
RELOAD="${RELOAD:-systemctl reload caddy}"
DIR="${1:-}"

[ -n "$DIR" ] && [ -f "$DIR/Caddyfile" ] && [ -f "$DIR/deployment-Caddyfile" ] || { echo "Usage: rollback-to-static.sh <backup directory written by switch-to-app.sh>" >&2; exit 2; }
if [ -z "${CADDYFILE_TEST:-}" ] && [ "$(id -u)" != 0 ]; then echo "Run as root on the VM." >&2; exit 2; fi

# Validate the restored file before it goes live.
$CADDY validate --config "$DIR/Caddyfile" --adapter caddyfile >/dev/null || { echo "The backup does not validate; nothing changed." >&2; exit 1; }
cp -p "$DIR/Caddyfile" "$CADDYFILE"
cp -p "$DIR/deployment-Caddyfile" "$TEMPLATE"
$RELOAD
rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
echo "Restored $CADDYFILE and $TEMPLATE from $DIR. sparkkindly.com serves the static export again."
