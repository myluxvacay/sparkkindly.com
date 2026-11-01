#!/usr/bin/env bash
# Hourly disk check: exit 1 (no heartbeat) when the root filesystem is DISK_THRESHOLD percent full or more, otherwise ping
# the disk heartbeat. A missing ping makes Better Stack email the owner.
# Runs as root from sparkkindly-disk.service. Verified by: tests/unit/backup-scripts.test.ts and OPERATIONS.md.
set -euo pipefail

ENV_FILE=${BACKUP_ENV_FILE:-/opt/sparkkindly/shared/backup.env}
THRESHOLD=${DISK_THRESHOLD:-80}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${HEARTBEAT_DISK_URL:?HEARTBEAT_DISK_URL missing in $ENV_FILE}"

USE=$(df --output=pcent "${DISK_PATH:-/}" | tail -n 1 | tr -dc 0-9)
if [ "$USE" -ge "$THRESHOLD" ]; then
  echo "Disk use ${USE}% is at or above threshold ${THRESHOLD}%" >&2
  exit 1
fi
echo "Disk use ${USE}%"
curl -fsS -m 10 --retry 3 "$HEARTBEAT_DISK_URL" > /dev/null
