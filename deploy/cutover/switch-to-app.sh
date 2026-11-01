#!/usr/bin/env bash
# CUT-OVER STEP (not run by anyone until the owner authorizes it; see docs/CUTOVER.md).
# Points sparkkindly.com at the SparkKindly app on 127.0.0.1:3100 by replacing the Caddy import of the static-site
# snippet with the app snippet, in BOTH Caddyfiles (they must be identical, as deploy/activate-public.py requires).
# MyLuxVacation's own blocks are never edited: only the single `import` line is swapped.
#
# Run on the VM as root:
#   deploy/cutover/switch-to-app.sh --confirm-owner-authorized --confirm-backup-verified [--dry-run]
#
# Safety: refuses unless both confirmations are given, the Caddyfiles are identical, the static import is present,
# and the production app is healthy and holds the imported content. Backs both Caddyfiles up to a timestamped directory,
# validates the candidate before touching a live file, reloads, checks the public host answers, and restores the
# backup automatically if validation, reload or the check fails. --dry-run stops after validation and changes nothing.
#
# Environment overrides exist so tests/unit/cutover-scripts.test.ts can run this against a temporary directory with
# stub commands: CADDYFILE, TEMPLATE, SNIPPET_DIR, BACKUP_ROOT, CADDY, RELOAD, APP_URL, PUBLIC_CHECK.
# Verified by: that test (dry run, success, restore on failed validation, restore on failed check); the real run is the
# owner's cut-over and its output is recorded in docs/CUTOVER.md.
set -euo pipefail

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TEMPLATE="${TEMPLATE:-/opt/myluxvacation/deploy/Caddyfile}"
SNIPPET_DIR="${SNIPPET_DIR:-/etc/caddy}"
BACKUP_ROOT="${BACKUP_ROOT:-/etc/caddy/sparkkindly-backups}"
CADDY="${CADDY:-caddy}"
RELOAD="${RELOAD:-systemctl reload caddy}"
APP_URL="${APP_URL:-http://127.0.0.1:3100}"
PUBLIC_CHECK="${PUBLIC_CHECK:-curl -fsS --max-time 15 -o /dev/null https://sparkkindly.com/api/health/}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/caddy/sparkkindly-public-app.caddy"
OLD_IMPORT="import ${SNIPPET_DIR}/sparkkindly-public.caddy"
NEW_IMPORT="import ${SNIPPET_DIR}/sparkkindly-public-app.caddy"

OWNER=0; BACKUP=0; DRY=0
for a in "$@"; do
  case "$a" in
    --confirm-owner-authorized) OWNER=1 ;;
    --confirm-backup-verified) BACKUP=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done
[ "$OWNER" = 1 ] || { echo "Refusing: owner authorization not confirmed (--confirm-owner-authorized)." >&2; exit 2; }
[ "$BACKUP" = 1 ] || { echo "Refusing: a verified backup and restore test is required (--confirm-backup-verified)." >&2; exit 2; }
if [ -z "${CADDYFILE_TEST:-}" ] && [ "$(id -u)" != 0 ]; then echo "Run as root on the VM." >&2; exit 2; fi

cmp -s "$CADDYFILE" "$TEMPLATE" || { echo "Refusing: the active and tracked Caddyfiles differ. Reconcile first." >&2; exit 1; }
grep -qxF "$OLD_IMPORT" "$CADDYFILE" || { echo "Refusing: static import line not found in the Caddyfile (already switched?)." >&2; exit 1; }
[ -f "$SRC" ] || { echo "Missing $SRC" >&2; exit 1; }

# The app must be healthy and must hold the imported content, or the switch would publish an empty site.
curl -fsS --max-time 10 "$APP_URL/api/health/" >/dev/null || { echo "Refusing: the app is not healthy on $APP_URL." >&2; exit 1; }
curl -fsS --max-time 10 -o /dev/null "$APP_URL/discover/a-day-in-shadows/" || { echo "Refusing: starter content is not imported in the production database." >&2; exit 1; }

STAMP="cutover-$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
cp -p "$TEMPLATE" "$BACKUP_DIR/deployment-Caddyfile"

CANDIDATE="$BACKUP_DIR/candidate.Caddyfile"
sed "s|^${OLD_IMPORT}\$|${NEW_IMPORT}|" "$CADDYFILE" > "$CANDIDATE"
cp "$SRC" "$BACKUP_DIR/new-snippet.caddy"
# Validate with the new snippet in place beside the candidate's imports.
cp "$SRC" "$SNIPPET_DIR/sparkkindly-public-app.caddy"
chmod 644 "$SNIPPET_DIR/sparkkindly-public-app.caddy"

restore() {
  echo "Restoring the previous Caddy configuration from $BACKUP_DIR" >&2
  cp -p "$BACKUP_DIR/Caddyfile" "$CADDYFILE"
  cp -p "$BACKUP_DIR/deployment-Caddyfile" "$TEMPLATE"
  rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
  $RELOAD || true
}

if ! $CADDY validate --config "$CANDIDATE" --adapter caddyfile >/dev/null; then
  echo "Candidate Caddyfile failed validation; nothing was changed." >&2
  rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
  exit 1
fi
if [ "$DRY" = 1 ]; then
  rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
  echo "Dry run OK: candidate validates. Nothing was changed. Backup scratch: $BACKUP_DIR"
  exit 0
fi

cp "$CANDIDATE" "$CADDYFILE"
cp "$CANDIDATE" "$TEMPLATE"
if ! $RELOAD; then restore; exit 1; fi
if ! $PUBLIC_CHECK; then restore; echo "Public check failed; rolled back." >&2; exit 1; fi

echo "sparkkindly.com now proxies to the app. Backup: $BACKUP_DIR"
echo "Rollback: deploy/cutover/rollback-to-static.sh $BACKUP_DIR"
echo "Remember: commit the one-line import change in the MyLuxVacation repository's deploy/Caddyfile."
