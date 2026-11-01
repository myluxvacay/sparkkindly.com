#!/usr/bin/env bash
# Monthly proof that backups can be restored: take the newest staging backup from B2, restore it into a scratch database,
# require the same number of public tables as the live staging database and at least one row in items, drop the scratch
# database, and only then ping the restore heartbeat. Never touches a live database.
# Runs as root from sparkkindly-restore-test.service. Verified by the by-hand run in OPERATIONS.md ("Restore").
set -euo pipefail

ENV_FILE=${BACKUP_ENV_FILE:-/opt/sparkkindly/shared/backup.env}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${B2_BUCKET:?}" "${HEARTBEAT_RESTORE_URL:?}"
SOURCE_DB=${RESTORE_TEST_SOURCE_DB:-sparkkindly_staging}
SCRATCH=sparkkindly_restoretest
HERE=$(cd "$(dirname "$0")" && pwd)

newest=$(rclone lsf --files-only "b2:$B2_BUCKET/db/" | grep "^$SOURCE_DB-" | sort | tail -n 1)
[ -n "$newest" ] || { echo "No $SOURCE_DB backup found in B2" >&2; exit 1; }
echo "Newest backup: $newest"

cleanup() { runuser -u postgres -- dropdb --if-exists "$SCRATCH" > /dev/null 2>&1 || true; }
trap cleanup EXIT

"$HERE/restore.sh" "b2:$B2_BUCKET/db/$newest" "$SCRATCH"
tables() { runuser -u postgres -- psql -d "$1" -tAc "select count(*) from pg_tables where schemaname='public'"; }
restored=$(tables "$SCRATCH")
live=$(tables "$SOURCE_DB")
[ "$restored" = "$live" ] || { echo "Table count differs: restored $restored, live $live" >&2; exit 1; }
rows=$(runuser -u postgres -- psql -d "$SCRATCH" -tAc "select count(*) from items")
[ "$rows" -ge 1 ] || { echo "Restored items table is empty" >&2; exit 1; }
echo "Table count matches: $restored; items: $rows"

cleanup
echo "Dropped $SCRATCH"
curl -fsS -m 10 --retry 3 "$HEARTBEAT_RESTORE_URL" > /dev/null
echo "Restore test complete"
