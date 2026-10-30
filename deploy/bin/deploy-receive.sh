#!/usr/bin/env bash
# Forced-command release receiver, installed at /opt/sparkkindly/bin/deploy-receive.sh.
# GitHub Actions (or the owner) pipes a gzipped release tarball to it over SSH; the target comes from
# SSH_ORIGINAL_COMMAND and must be "prod" or "staging". It extracts the release beside the others, runs the
# release's optional migrate.sh, switches the "current" symlink, restarts the service and waits for /api/health.
# If the new release is not healthy it switches back. "previous" is only ever set from a release that passed health.
# Verified by: plan Task 5 steps 3 to 8.
set -euo pipefail

TARGET="${SSH_ORIGINAL_COMMAND:-}"
case "$TARGET" in
  prod)    ROOT=/opt/sparkkindly;         SERVICE=sparkkindly-web;         PORT=3100; ENVFILE=prod.env ;;
  staging) ROOT=/opt/sparkkindly-staging; SERVICE=sparkkindly-web-staging; PORT=3101; ENVFILE=staging.env ;;
  *) echo "Unknown target: ${TARGET}" >&2; exit 2 ;;
esac
SHARED=/opt/sparkkindly/shared
umask 027

# 1. Extract into a scratch directory; nothing goes live unless the release looks complete.
INCOMING=$(mktemp -d "$ROOT/releases/.incoming.XXXXXX")
trap 'rm -rf "$INCOMING"' EXIT
if ! tar -xzf - -C "$INCOMING" --no-same-owner; then
  echo "Release extraction failed; nothing changed" >&2
  exit 1
fi
if [ ! -f "$INCOMING/server.js" ] || [ ! -s "$INCOMING/RELEASE" ]; then
  echo "Release is missing server.js or RELEASE; nothing changed" >&2
  exit 1
fi
SHA7=$(cut -c1-7 "$INCOMING/RELEASE")
if ! [[ "$SHA7" =~ ^[0-9a-f]{7}$ ]]; then
  echo "RELEASE does not start with a 7-character commit hash; nothing changed" >&2
  exit 1
fi
NEW="$ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$SHA7"
mv "$INCOMING" "$NEW"
trap - EXIT

# 2. Optional migration hook (Project 1). A failing migration leaves the old release running.
if [ -x "$NEW/migrate.sh" ]; then
  if ! (cd "$NEW" && set -a && . "$SHARED/$ENVFILE" && set +a && ./migrate.sh); then
    echo "Migration failed; the previous release is still serving" >&2
    exit 1
  fi
fi

# 3. Switch and restart.
OLD=$(readlink "$ROOT/current" 2>/dev/null || true)
ln -sfn "$NEW" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"
sudo systemctl restart "$SERVICE"

# 4. Health gate: 30 tries, one second apart. The deploy only succeeds on an ok:true report.
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done

if [ "$healthy" -eq 1 ]; then
  if [ -n "$OLD" ]; then
    ln -sfn "$OLD" "$ROOT/previous.tmp"
    mv -T "$ROOT/previous.tmp" "$ROOT/previous"
  fi
  # Keep the newest five releases, never pruning the live or previous one.
  keep_current=$(basename "$NEW"); keep_previous=$([ -n "$OLD" ] && basename "$OLD" || true)
  ls -1t "$ROOT/releases" | grep -E '^[0-9]{8}T[0-9]{6}Z-' | tail -n +6 | while read -r release; do
    [ "$release" = "$keep_current" ] || [ "$release" = "$keep_previous" ] || rm -rf "${ROOT:?}/releases/$release"
  done
  echo "Healthy: $TARGET $SHA7"
else
  echo "Health check failed, rolling back" >&2
  if [ -n "$OLD" ]; then
    ln -sfn "$OLD" "$ROOT/current.tmp"
    mv -T "$ROOT/current.tmp" "$ROOT/current"
    sudo systemctl restart "$SERVICE"
    echo "Rolled back to $(basename "$OLD")" >&2
  else
    echo "No earlier release to roll back to (first deploy)" >&2
  fi
  journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
  exit 1
fi
