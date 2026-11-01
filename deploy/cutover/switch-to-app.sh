#!/usr/bin/env bash
# CUT-OVER STEP (not run by anyone until the owner authorizes it; see docs/CUTOVER.md).
# Points sparkkindly.com at the SparkKindly app on 127.0.0.1:3100 by replacing the Caddy import of the static-site
# snippet with the app snippet, in BOTH Caddyfiles (they must be identical, as deploy/activate-public.py requires).
# MyLuxVacation's own blocks are never edited: only the single `import` line is swapped.
#
# Run on the VM as root, from a copy of deploy/cutover/ and deploy/caddy/ whose checksums you compared with the commit
# (docs/CUTOVER.md, "Getting the scripts onto the VM"):
#   deploy/cutover/switch-to-app.sh --confirm-owner-authorized --confirm-backup-verified [--dry-run]
#
# Safety: refuses unless both confirmations are given, the snippet matches its pinned checksum, the Caddyfiles are
# identical, the static import is present exactly once, and the production app is healthy, holds the imported content,
# is a release build (robots.txt allows crawling, no preview notice). Backs both Caddyfiles up to a timestamped
# directory, builds a candidate that must differ by exactly one line, validates it before touching a live file, and
# re-checks that nothing changed since the backup. From the first live write until the public checks pass, a trap
# (error, Ctrl-C, TERM) restores both files, reloads, and verifies the static site and myluxvacation.com. Exit codes are
# in lib.sh. --dry-run stops after validation and changes nothing.
#
# Environment overrides exist so tests/unit/cutover-scripts.test.ts can run this against a temporary directory with stub
# commands (CADDYFILE_TEST skips only the root check). Verified by: that test; the real run is the owner's cut-over.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
APP_URL="${APP_URL:-http://127.0.0.1:3100}"
SRC="$HERE/../caddy/sparkkindly-public-app.caddy"
# Pinned checksum of deploy/caddy/sparkkindly-public-app.caddy (LF endings). Update it in the same commit as the snippet;
# a test fails if they drift apart.
SNIPPET_SHA256="a5b75312f0769057767e5a73894e27ce5cb6832c6a8554268ecc464c2232f05f"

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
need_root

[ -f "$SRC" ] || { echo "Missing $SRC" >&2; exit 1; }
ACTUAL_SHA="$(sha256sum "$SRC" | cut -d' ' -f1)"
[ "$ACTUAL_SHA" = "$SNIPPET_SHA256" ] || { echo "Refusing: snippet checksum $ACTUAL_SHA does not match the pinned $SNIPPET_SHA256." >&2; exit 1; }
cmp -s "$CADDYFILE" "$TEMPLATE" || { echo "Refusing: the active and tracked Caddyfiles differ. Reconcile first." >&2; exit 1; }
[ "$(grep -cxF "$OLD_IMPORT" "$CADDYFILE")" = 1 ] || { echo "Refusing: the static import line must appear exactly once in the Caddyfile (already switched?)." >&2; exit 1; }

# The app must be healthy, hold the imported content and be a release build, or the switch would publish a broken site.
curl -fsS --max-time 10 "$APP_URL/api/health/" >/dev/null || { echo "Refusing: the app is not healthy on $APP_URL." >&2; exit 1; }
curl -fsS --max-time 10 -o /dev/null "$APP_URL/discover/a-day-in-shadows/" || { echo "Refusing: starter content is not imported in the production database." >&2; exit 1; }
ROBOTS="$(curl -fsS --max-time 10 "$APP_URL/robots.txt" || true)"
{ printf '%s\n' "$ROBOTS" | grep -q '^Allow: /' && ! printf '%s\n' "$ROBOTS" | grep -q '^Disallow: /$'; } \
  || { echo "Refusing: $APP_URL/robots.txt does not allow crawling; the app is not a release build (SITE_RELEASE=true)." >&2; exit 1; }
if curl -fsS --max-time 10 "$APP_URL/" | grep -qi 'Development preview'; then
  echo "Refusing: the home page carries the preview notice; the app is a preview build." >&2; exit 1
fi

STAMP="cutover-$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
cp -p "$TEMPLATE" "$BACKUP_DIR/deployment-Caddyfile"
CANDIDATE="$BACKUP_DIR/candidate.Caddyfile"
sed "s|^${OLD_IMPORT}\$|${NEW_IMPORT}|" "$CADDYFILE" > "$CANDIDATE"
[ "$(changed_lines "$CADDYFILE" "$CANDIDATE")" = 2 ] || { echo "Refusing: the candidate must differ from the Caddyfile by exactly one line." >&2; exit 1; }

# Validate with the new snippet in place beside the candidate's imports (a new file nothing imports yet).
cp "$SRC" "$SNIPPET_DIR/sparkkindly-public-app.caddy"
chmod 644 "$SNIPPET_DIR/sparkkindly-public-app.caddy"
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

# Nothing may have changed between the backup and the live write.
if ! cmp -s "$CADDYFILE" "$BACKUP_DIR/Caddyfile" || ! cmp -s "$TEMPLATE" "$BACKUP_DIR/deployment-Caddyfile"; then
  rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
  echo "Refusing: a Caddyfile changed since the backup was taken. Nothing was changed." >&2
  exit 1
fi

# From here until the public checks pass, any failure or interrupt restores both files, reloads and verifies.
on_failure() {
  trap - ERR INT TERM
  set +e
  echo "$1" >&2
  cp -p "$BACKUP_DIR/Caddyfile" "$CADDYFILE"
  cp -p "$BACKUP_DIR/deployment-Caddyfile" "$TEMPLATE"
  rm -f "$SNIPPET_DIR/sparkkindly-public-app.caddy"
  reload_caddy || { echo "ROLLBACK INCOMPLETE: both Caddyfiles are restored on disk but Caddy did not reload them." >&2; exit 3; }
  verify_static || { echo "ROLLBACK NOT CONFIRMED: files restored and Caddy reloaded, but the live site did not pass its checks. Look at sparkkindly.com now." >&2; exit 4; }
  echo "Previous configuration restored; the static site answers and myluxvacation.com answers; rolled back." >&2
  exit 1
}
trap 'on_failure "A command failed or the script was interrupted after the live write."' ERR INT TERM

cp "$CANDIDATE" "$CADDYFILE"
cp "$CANDIDATE" "$TEMPLATE"
reload_caddy || on_failure "Caddy reload failed after the switch."
eval "$PUBLIC_CHECK" || on_failure "Public check failed after the switch."
eval "$MLV_CHECK" || on_failure "myluxvacation.com check failed after the switch."
trap - ERR INT TERM

echo "sparkkindly.com now proxies to the app. Backup: $BACKUP_DIR"
echo "Rollback: deploy/cutover/rollback-to-static.sh $BACKUP_DIR"
echo "Remember: commit the one-line import change in the MyLuxVacation repository's deploy/Caddyfile."
