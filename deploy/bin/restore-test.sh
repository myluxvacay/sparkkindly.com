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

cleanup() { runuser -u postgres -- env -u RCLONE_CONFIG_B2_KEY -u RCLONE_CONFIG_B2_ACCOUNT -u HEARTBEAT_BACKUP_URL -u HEARTBEAT_RESTORE_URL -u HEARTBEAT_DISK_URL dropdb --if-exists "$SCRATCH" > /dev/null 2>&1 || true; }
trap cleanup EXIT

# The role that owns the live data owns the scratch copy too (role names match database names).
RESTORE_OWNER=$SOURCE_DB "$HERE/restore.sh" "b2:$B2_BUCKET/db/$newest" "$SCRATCH"
tables() { runuser -u postgres -- env -u RCLONE_CONFIG_B2_KEY -u RCLONE_CONFIG_B2_ACCOUNT -u HEARTBEAT_BACKUP_URL -u HEARTBEAT_RESTORE_URL -u HEARTBEAT_DISK_URL psql -d "$1" -tAc "select count(*) from pg_tables where schemaname='public'"; }
restored=$(tables "$SCRATCH")
live=$(tables "$SOURCE_DB")
[ "$restored" = "$live" ] || { echo "Table count differs: restored $restored, live $live" >&2; exit 1; }
# Restored content is data, not trusted code, and SET ROLE inside a superuser session is not a sandbox (restored code could
# reset it). So run nothing from the restored database: confirm public.items is a plain table (relkind r, not a view whose
# definition could call restored functions), then count it with ONLY from a fixed search_path. A plain-table count(*) as
# superuser executes no user-defined code (no triggers or output functions run on a SELECT).
rows=$(runuser -u postgres -- env -u RCLONE_CONFIG_B2_KEY -u RCLONE_CONFIG_B2_ACCOUNT -u HEARTBEAT_BACKUP_URL -u HEARTBEAT_RESTORE_URL -u HEARTBEAT_DISK_URL psql -d "$SCRATCH" -v ON_ERROR_STOP=1 -tA <<'SQL' | tail -n 1
SET search_path = pg_catalog;
SELECT CASE WHEN (SELECT relkind FROM pg_class WHERE oid = 'public.items'::regclass) = 'r'
            THEN (SELECT count(*) FROM ONLY public.items) ELSE -1 END;
SQL
)
[ "$rows" -ge 1 ] || { echo "Restored items is missing, not a plain table, or empty" >&2; exit 1; }
echo "Table count matches: $restored; items: $rows"

cleanup
echo "Dropped $SCRATCH"
curl -fsS -m 10 --retry 3 "$HEARTBEAT_RESTORE_URL" > /dev/null
echo "Restore test complete"
