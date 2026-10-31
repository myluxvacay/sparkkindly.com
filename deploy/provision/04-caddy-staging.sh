#!/usr/bin/env bash
# Put the staging site behind Caddy with basic auth: install the site snippet and its credentials file, add one
# import line to BOTH Caddyfiles, validate, and reload. If validation fails, both Caddyfiles are restored and nothing
# is reloaded. MyLuxVacation's own blocks are never edited.
# Run as root on the VM after 03-services.sh, from the directory that contains deploy/.
# Idempotent. Verified by: plan Task 7 steps 3 to 5.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SNIPPET_SRC="$HERE/../caddy/sparkkindly-staging.caddy"
ACTIVE=/etc/caddy/Caddyfile
TRACKED=/opt/myluxvacation/deploy/Caddyfile
SNIPPET=/etc/caddy/sparkkindly-staging.caddy
USERS=/etc/caddy/sparkkindly-staging.users
CRED=/opt/sparkkindly/shared/staging-basic-auth.txt
IMPORT_LINE="import $SNIPPET"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
[ -f "$SNIPPET_SRC" ] || { echo "Missing $SNIPPET_SRC" >&2; exit 1; }
cmp -s "$ACTIVE" "$TRACKED" || { echo "Active and tracked Caddyfiles differ; reconcile first (activate-public.py requires them identical)" >&2; exit 1; }

echo "== Back up both Caddyfiles"
ts=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/caddy-backups/$ts
install -d -m 700 "$backup"
cp -p "$ACTIVE" "$backup/Caddyfile.active"
cp -p "$TRACKED" "$backup/Caddyfile.tracked"
echo "$backup"

restore() {
  echo "Restoring both Caddyfiles from $backup" >&2
  cp -p "$backup/Caddyfile.active" "$ACTIVE"
  cp -p "$backup/Caddyfile.tracked" "$TRACKED"
}

echo "== Credentials (generated once; plaintext kept root-only for the owner's monitor)"
if [ ! -s "$USERS" ]; then
  pass=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  hash=$(caddy hash-password --plaintext "$pass")
  printf 'sparkkindly %s\n' "$hash" > "$USERS"
  (umask 077; printf 'user: sparkkindly\npassword: %s\n' "$pass" > "$CRED")
fi
chown root:caddy "$USERS"; chmod 640 "$USERS"
chown root:root "$CRED"; chmod 600 "$CRED"

echo "== Install snippet and add the import to both Caddyfiles"
install -m 644 -o root -g root "$SNIPPET_SRC" "$SNIPPET"
for f in "$ACTIVE" "$TRACKED"; do
  grep -qxF "$IMPORT_LINE" "$f" || { [ -z "$(tail -c1 "$f")" ] || echo >> "$f"; echo "$IMPORT_LINE" >> "$f"; }
done
cmp -s "$ACTIVE" "$TRACKED" || { echo "Caddyfiles diverged after edit" >&2; restore; exit 1; }

echo "== Validate, then reload"
if ! caddy validate --config "$ACTIVE" --adapter caddyfile; then
  restore
  exit 1
fi
systemctl reload caddy
echo "Reloaded. Caddy will now obtain a certificate for staging.sparkkindly.com (usually under a minute)."
