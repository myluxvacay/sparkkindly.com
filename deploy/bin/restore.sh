#!/usr/bin/env bash
# Restore one encrypted backup into a database: restore.sh <local-file | b2:bucket/db/<name>> <target-db> [--force]
# Decrypts with the age private key on this server, drops and recreates the target, runs pg_restore. It REFUSES the
# live databases (sparkkindly, sparkkindly_staging) unless --force is the third argument, so a typo cannot overwrite them.
# Stop the matching web service first for a real restore (see OPERATIONS.md, "Restore").
# Runs as root. Verified by: tests/unit/backup-scripts.test.ts (refusal) and the restore test in OPERATIONS.md.
set -euo pipefail

SRC=${1:?usage: restore.sh <file-or-b2-path> <target-db> [--force]}
DB=${2:?usage: restore.sh <file-or-b2-path> <target-db> [--force]}
FORCE=${3:-}
AGE_KEY=${AGE_KEY_FILE:-/root/.config/sparkkindly/age.key}
WORK=${RESTORE_DIR:-/var/backups/sparkkindly/restore}

case "$DB" in
  sparkkindly | sparkkindly_staging)
    if [ "$FORCE" != "--force" ]; then
      echo "Refusing to overwrite $DB without --force" >&2
      exit 3
    fi
    ;;
esac
[[ "$DB" =~ ^[a-z0-9_]+$ ]] || { echo "Bad database name" >&2; exit 2; }
[ -r "$AGE_KEY" ] || { echo "Age private key not found at $AGE_KEY" >&2; exit 2; }

mkdir -p "$WORK" && chmod 700 "$WORK"
if [[ "$SRC" == b2:* ]]; then
  rclone copy "$SRC" "$WORK/"
  FILE="$WORK/$(basename "$SRC")"
else
  FILE="$SRC"
fi
[ -f "$FILE" ] || { echo "Backup file not found: $FILE" >&2; exit 2; }

DUMP="$WORK/restore-$$.dump"
trap 'rm -f "$DUMP"' EXIT
age -d -i "$AGE_KEY" -o "$DUMP" "$FILE"

# The owner role is named after the database's service (sparkkindly or sparkkindly_staging).
OWNER=sparkkindly
[[ "$DB" == *staging* ]] && OWNER=sparkkindly_staging
runuser -u postgres -- dropdb --if-exists "$DB"
runuser -u postgres -- createdb -O "$OWNER" "$DB"
runuser -u postgres -- pg_restore -d "$DB" --no-owner --role="$OWNER" "$DUMP"
echo "Restored $(basename "$FILE") into $DB"
