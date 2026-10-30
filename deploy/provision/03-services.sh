#!/usr/bin/env bash
# Install SparkKindly's systemd units, the release receiver, the restricted sudoers rules and the forced-command
# deploy keys (one per deploy user, each pinned to its own target).
# Run as root on the VM after 02-postgres.sh, from the directory that contains deploy/.
# Usage: bash deploy/provision/03-services.sh "<deploy public key line>"
# Idempotent. Verified by: plan Task 5 steps 2 to 8.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY="$HERE/.."
PUBKEY="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
[ -n "$PUBKEY" ] || { echo "Usage: $0 \"ssh-ed25519 AAAA… sparkkindly-deploy\"" >&2; exit 1; }
case "$PUBKEY" in ssh-ed25519\ *) ;; *) echo "Expected an ssh-ed25519 public key line" >&2; exit 1 ;; esac
id sparkkindly >/dev/null 2>&1 && id sparkkindly-staging >/dev/null 2>&1 || { echo "Run 01-base.sh first" >&2; exit 1; }

echo "== systemd units"
install -m 644 "$DEPLOY/systemd/sparkkindly-web.service" "$DEPLOY/systemd/sparkkindly-web-staging.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable sparkkindly-web sparkkindly-web-staging >/dev/null 2>&1

echo "== Release receiver (root-owned; the service users can run it but not change it)"
install -m 755 -o root -g root "$DEPLOY/bin/deploy-receive.sh" /opt/sparkkindly/bin/deploy-receive.sh

echo "== sudoers (validated before install)"
tmp=$(mktemp)
cp "$DEPLOY/sudoers.d/sparkkindly" "$tmp"
visudo -cf "$tmp"
install -m 440 -o root -g root "$tmp" /etc/sudoers.d/sparkkindly
rm -f "$tmp"

echo "== Forced-command deploy keys (root-owned files in root-owned directories)"
for pair in sparkkindly:prod sparkkindly-staging:staging; do
  user=${pair%%:*}; target=${pair##*:}
  keyfile="/opt/sparkkindly/home/$user/.ssh/authorized_keys"
  printf 'command="/opt/sparkkindly/bin/deploy-receive.sh %s",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' "$target" "$PUBKEY" > "$keyfile"
  chown root:root "$keyfile"
  chmod 644 "$keyfile"
done

systemctl is-enabled sparkkindly-web sparkkindly-web-staging
