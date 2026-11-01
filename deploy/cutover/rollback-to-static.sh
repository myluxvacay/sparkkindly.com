#!/usr/bin/env bash
# CUT-OVER ROLLBACK (written, not run). Puts sparkkindly.com back on the static export by reversing the single import
# line (app snippet back to static snippet) in the CURRENT Caddyfiles. It never restores an old snapshot, so newer
# MyLuxVacation edits to the Caddyfile survive and an unrelated backup (for example one from activate-public.py) can
# never be applied. The static export (/var/www/sparkkindly/public/current) is never modified by the cut-over, so
# this takes effect on the Caddy reload. The app keeps running on loopback; no data is touched.
#
#   deploy/cutover/rollback-to-static.sh [/etc/caddy/sparkkindly-backups/cutover-YYYYMMDD-HHMMSS]
#
# The optional directory is a safety check only: it must be named cutover-*, and its candidate.Caddyfile must be
# identical to the current Caddyfile (proving it is the snapshot of the switch that is live now).
# Refuses if the two Caddyfiles differ, the app import is not present exactly once, or the result would differ by more
# than one line. Validates before touching a live file. Reload failure exits 3 (files put back as they were);
# "rolled back" is printed only after sparkkindly.com serves the static site again and myluxvacation.com answers,
# otherwise exit 4. Exit codes are in lib.sh.
# Verified by: tests/unit/cutover-scripts.test.ts (stub commands). Same environment overrides as switch-to-app.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
DIR="${1:-}"

if [ -n "$DIR" ]; then
  case "$(basename "$DIR")" in cutover-*) ;; *) echo "Refusing: $DIR is not a cutover-* snapshot written by switch-to-app.sh." >&2; exit 2 ;; esac
  [ -f "$DIR/candidate.Caddyfile" ] || { echo "Refusing: $DIR has no candidate.Caddyfile." >&2; exit 2; }
  cmp -s "$DIR/candidate.Caddyfile" "$CADDYFILE" || { echo "Refusing: $DIR does not match the Caddyfile that is live now." >&2; exit 2; }
fi
need_root

cmp -s "$CADDYFILE" "$TEMPLATE" || { echo "Refusing: the active and tracked Caddyfiles differ. Reconcile first." >&2; exit 1; }
[ "$(grep -cxF "$NEW_IMPORT" "$CADDYFILE")" = 1 ] || { echo "Refusing: the app import line is not present exactly once; nothing to roll back." >&2; exit 1; }

STAMP="rollback-$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
cp -p "$TEMPLATE" "$BACKUP_DIR/deployment-Caddyfile"
CANDIDATE="$BACKUP_DIR/candidate.Caddyfile"
sed "s|^${NEW_IMPORT}\$|${OLD_IMPORT}|" "$CADDYFILE" > "$CANDIDATE"
[ "$(changed_lines "$CADDYFILE" "$CANDIDATE")" = 2 ] || { echo "Refusing: the result must differ from the Caddyfile by exactly one line." >&2; exit 1; }
$CADDY validate --config "$CANDIDATE" --adapter caddyfile >/dev/null || { echo "The rolled-back Caddyfile does not validate; nothing changed." >&2; exit 1; }
if ! cmp -s "$CADDYFILE" "$BACKUP_DIR/Caddyfile" || ! cmp -s "$TEMPLATE" "$BACKUP_DIR/deployment-Caddyfile"; then
  echo "Refusing: a Caddyfile changed while this script was preparing. Nothing was changed." >&2; exit 1
fi

cp "$CANDIDATE" "$CADDYFILE"
cp "$CANDIDATE" "$TEMPLATE"
if ! reload_caddy; then
  cp -p "$BACKUP_DIR/Caddyfile" "$CADDYFILE"
  cp -p "$BACKUP_DIR/deployment-Caddyfile" "$TEMPLATE"
  echo "The Caddyfiles were put back as they were before this script; fix the reload problem and run it again." >&2
  exit 3
fi
rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
verify_static || { echo "ROLLBACK NOT CONFIRMED: Caddy reloaded the static configuration but the live checks failed. Look at sparkkindly.com and myluxvacation.com now." >&2; exit 4; }
echo "Reversed the import in $CADDYFILE and $TEMPLATE (backup of the previous state: $BACKUP_DIR). sparkkindly.com serves the static export and myluxvacation.com answers; rolled back."
