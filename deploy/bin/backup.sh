#!/usr/bin/env bash
# Nightly encrypted PostgreSQL backup to Backblaze B2. For each database in BACKUP_DATABASES: pg_dump (custom format),
# encrypt with age to the public key in AGE_RECIPIENT (the private key never leaves the owner's copy and the server's
# root-only key file), refuse a dump smaller than BACKUP_MIN_BYTES, and upload. Retention is a B2 lifecycle rule.
# The heartbeat is pinged ONLY after every step succeeded, so a missing ping means the backup did not complete.
# Runs as root from sparkkindly-backup.service. Config comes from /opt/sparkkindly/shared/backup.env (mode 600).
# Verified by: tests/unit/backup-scripts.test.ts (failure paths, with stubbed tools) and the by-hand run in OPERATIONS.md.
set -euo pipefail

ENV_FILE=${BACKUP_ENV_FILE:-/opt/sparkkindly/shared/backup.env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/sparkkindly}
MIN_BYTES=${BACKUP_MIN_BYTES:-10240}

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${AGE_RECIPIENT:?AGE_RECIPIENT missing in $ENV_FILE}" "${B2_BUCKET:?B2_BUCKET missing}" \
  "${BACKUP_DATABASES:?BACKUP_DATABASES missing}" "${HEARTBEAT_BACKUP_URL:?HEARTBEAT_BACKUP_URL missing}"

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
partial=""
trap '[ -z "$partial" ] || rm -f "$partial"' EXIT

for db in $BACKUP_DATABASES; do
  file="$BACKUP_DIR/$db-$stamp.dump.age"
  partial="$file.partial"
  echo "== $db"
  # pipefail makes a failed pg_dump fail the whole pipeline, so nothing half-written is kept or uploaded.
  runuser -u postgres -- env -u RCLONE_CONFIG_B2_KEY -u RCLONE_CONFIG_B2_ACCOUNT -u HEARTBEAT_BACKUP_URL -u HEARTBEAT_RESTORE_URL -u HEARTBEAT_DISK_URL pg_dump -Fc "$db" | age -r "$AGE_RECIPIENT" -o "$partial"
  size=$(stat -c %s "$partial")
  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "Backup of $db is only $size bytes (minimum $MIN_BYTES); not uploading" >&2
    exit 1
  fi
  mv "$partial" "$file"
  partial=""
  rclone copyto "$file" "b2:$B2_BUCKET/db/$(basename "$file")"
  echo "Uploaded $(basename "$file") ($size bytes)"
done

# Retention is NOT done here: this server's key must not be able to delete backups a compromised server could then wipe.
# A B2 bucket lifecycle rule (hide after 30 days, delete a day later; OPERATIONS.md) enforces the 30 days. Local copies
# are kept two days.
find "$BACKUP_DIR" -name '*.dump.age' -mtime +2 -delete

curl -fsS -m 10 --retry 3 "$HEARTBEAT_BACKUP_URL" > /dev/null
echo "Backup complete"
