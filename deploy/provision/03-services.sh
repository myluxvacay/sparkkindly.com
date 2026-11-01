#!/usr/bin/env bash
# Install SparkKindly's systemd units, the release receiver, the restricted sudoers rules and the forced-command
# deploy keys (one per deploy user, each pinned to its own target).
# Run as root on the VM after 02-postgres.sh, from the directory that contains deploy/.
# Usage: bash deploy/provision/03-services.sh "<prod deploy public key>" "<staging deploy public key>"
# The two keys must differ: a compromised staging pipeline then cannot deploy production.
# Idempotent. Verified by: plan Task 5 steps 2 to 8.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY="$HERE/.."
PROD_KEY="${1:-}"
STAGING_KEY="${2:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
if [ -z "$PROD_KEY" ] || [ -z "$STAGING_KEY" ]; then
  echo "Usage: $0 \"<prod ssh-ed25519 key>\" \"<staging ssh-ed25519 key>\"" >&2
  exit 1
fi
for k in "$PROD_KEY" "$STAGING_KEY"; do
  case "$k" in ssh-ed25519\ *) ;; *) echo "Expected ssh-ed25519 public key lines" >&2; exit 1 ;; esac
done
# Compare the key material (second field), ignoring the comment.
if [ "$(echo "$PROD_KEY" | cut -d' ' -f2)" = "$(echo "$STAGING_KEY" | cut -d' ' -f2)" ]; then
  echo "Prod and staging deploy keys must be different keys" >&2
  exit 1
fi
id sparkkindly >/dev/null 2>&1 && id sparkkindly-staging >/dev/null 2>&1 || { echo "Run 01-base.sh first" >&2; exit 1; }

echo "== systemd units"
install -m 644 "$DEPLOY/systemd/sparkkindly-web.service" "$DEPLOY/systemd/sparkkindly-web-staging.service" /etc/systemd/system/
# Worker (Project 1C): a oneshot service per environment, run every minute by its timer.
install -m 644 "$DEPLOY/systemd/sparkkindly-worker.service" "$DEPLOY/systemd/sparkkindly-worker.timer"   "$DEPLOY/systemd/sparkkindly-worker-staging.service" "$DEPLOY/systemd/sparkkindly-worker-staging.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable sparkkindly-web sparkkindly-web-staging >/dev/null 2>&1
# A timer starts only once its live release contains worker.mjs (the first deploy that includes Project 1C).
[ -f /opt/sparkkindly/app/current/worker.mjs ] && systemctl enable --now sparkkindly-worker.timer >/dev/null 2>&1
[ -f /opt/sparkkindly-staging/current/worker.mjs ] && systemctl enable --now sparkkindly-worker-staging.timer >/dev/null 2>&1

echo "== Release receiver (root-owned; the service users can run it but not change it)"
install -m 755 -o root -g root "$DEPLOY/bin/deploy-receive.sh" /opt/sparkkindly/bin/deploy-receive.sh

echo "== sudoers (validated before install)"
tmp=$(mktemp)
cp "$DEPLOY/sudoers.d/sparkkindly" "$tmp"
visudo -cf "$tmp"
install -m 440 -o root -g root "$tmp" /etc/sudoers.d/sparkkindly
rm -f "$tmp"

echo "== Forced-command deploy keys (root-owned files in root-owned directories)"
write_key() { # user target key
  local keyfile="/opt/sparkkindly/home/$1/.ssh/authorized_keys"
  printf 'command="/opt/sparkkindly/bin/deploy-receive.sh %s",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' "$2" "$3" > "$keyfile"
  chown root:root "$keyfile"
  chmod 644 "$keyfile"
}
write_key sparkkindly prod "$PROD_KEY"
write_key sparkkindly-staging staging "$STAGING_KEY"

systemctl is-enabled sparkkindly-web sparkkindly-web-staging
systemctl list-timers --all 'sparkkindly-worker*' --no-pager || true
